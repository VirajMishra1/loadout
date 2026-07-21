import { execFile } from "node:child_process";
import { readdir, rm, rmdir } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { promisify } from "node:util";
import { loadoutHome } from "./paths.js";
import { applyRemove, planRemove, type RemovePlan } from "./remove.js";
import {
  applyRuntimeToolPlan,
  listInstalledRuntimeTools,
  planRuntimeTool,
} from "./runtime-tools.js";
import {
  applyNativeSchedulerBundle,
  planNativeScheduler,
  type NativeSchedulerPlan,
} from "./scheduler.js";
import { readInstallState } from "./state.js";

export interface CompleteUninstallPlan {
  stateHome: string;
  packages: RemovePlan[];
  runtimeTools: string[];
  schedulers: UninstallSchedulerPlan[];
  disabledLibraryRecords: number;
  blocked: boolean;
  warnings: string[];
}

export type UninstallSchedulerPlan = Pick<
  NativeSchedulerPlan,
  "action" | "job"
> &
  Partial<NativeSchedulerPlan>;

interface UninstallDependencies {
  runtimeTools?: (stateHome?: string) => Promise<string[]>;
  schedulerPlans?: () => UninstallSchedulerPlan[];
  unschedule?: (plans: UninstallSchedulerPlan[]) => Promise<void>;
}

export async function buildUninstallPlan(
  dependencies: UninstallDependencies = {},
): Promise<CompleteUninstallPlan> {
  const stateHome = loadoutHome();
  const state = await readInstallState();
  const packageIds = [
    ...new Set([
      ...state.installs.map((install) => install.packageId),
      ...(state.mcpInstalls ?? []).map((install) => install.packageId),
    ]),
  ];
  const packages = await Promise.all(packageIds.map(planRemove));
  const runtimeTools = await (
    dependencies.runtimeTools ?? listInstalledRuntimeTools
  )(stateHome);
  const schedulers =
    dependencies.schedulerPlans?.() ??
    (["updates", "discovery"] as const).map((job) =>
      planNativeScheduler("unschedule", { job }),
    );
  const warnings = packages.flatMap((entry) => entry.warnings);
  if (runtimeTools.length)
    warnings.push(
      `${runtimeTools.length} Loadout-managed runtime tool(s) will be restored to their pre-install snapshots.`,
    );
  warnings.push(
    "Loadout's cache, disabled library, history, and rollback snapshots will be deleted. This final state cleanup cannot itself be rolled back.",
  );
  return {
    stateHome,
    packages,
    runtimeTools,
    schedulers,
    disabledLibraryRecords: (state.activations ?? []).filter(
      (entry) => entry.activationState === "disabled",
    ).length,
    blocked: packages.some((entry) => entry.blocked),
    warnings,
  };
}

async function removeEmptyManagedDirectories(
  plans: RemovePlan[],
): Promise<void> {
  const candidates = [
    ...new Set(
      plans.flatMap((plan) => plan.files.map((file) => dirname(file.path))),
    ),
  ].sort((left, right) => right.length - left.length);
  for (const directory of candidates) {
    try {
      const queue = [directory];
      const visited = [directory];
      let entriesChecked = 0;
      let empty = true;
      while (queue.length && empty) {
        const current = queue.pop()!;
        for (const entry of await readdir(current, { withFileTypes: true })) {
          entriesChecked += 1;
          if (entriesChecked > 10_000) {
            empty = false;
            break;
          }
          if (entry.isDirectory() && !entry.isSymbolicLink()) {
            const child = resolve(current, entry.name);
            queue.push(child);
            visited.push(child);
          } else {
            empty = false;
            break;
          }
        }
      }
      if (empty)
        for (const current of visited.sort(
          (left, right) => right.length - left.length,
        ))
          await rmdir(current);
    } catch {
      // Missing and non-empty directories are both safe to leave alone.
    }
  }
}

function assertSafeStateHome(stateHome: string): void {
  const expected = resolve(loadoutHome());
  const selected = resolve(stateHome);
  const root = parse(selected).root;
  if (selected !== expected || selected === root)
    throw new Error(
      `Refusing unsafe Loadout state deletion target: ${selected}`,
    );
}

export async function applyUninstall(
  plan: CompleteUninstallPlan,
  dependencies: UninstallDependencies = {},
  options: { force?: boolean; onProgress?: (message: string) => void } = {},
): Promise<{ removedPackages: number; removedRuntimeTools: number }> {
  assertSafeStateHome(plan.stateHome);
  const fresh = await buildUninstallPlan(dependencies);
  if (fresh.blocked && !options.force)
    throw new Error(
      `Complete uninstall is blocked because managed files were modified. Review them, or re-run with --force. ${fresh.warnings.join(" ")}`,
    );

  for (const id of fresh.runtimeTools) {
    options.onProgress?.(`Removing runtime tool: ${id}`);
    const runtimePlan = await planRuntimeTool(id, {
      action: "remove",
      stateHome: fresh.stateHome,
    });
    await applyRuntimeToolPlan(runtimePlan, { approveRisk: true });
  }
  for (const [index, packagePlan] of fresh.packages.entries()) {
    options.onProgress?.(
      `${packagePlan.preserveFiles ? "Forgetting adopted ownership" : "Removing managed package"} [${index + 1}/${fresh.packages.length}]: ${packagePlan.packageId}`,
    );
    await applyRemove(packagePlan, { force: options.force });
  }
  await removeEmptyManagedDirectories(fresh.packages);
  if (fresh.schedulers.length) {
    options.onProgress?.("Removing daily read-only schedules");
    await (dependencies.unschedule
      ? dependencies.unschedule(fresh.schedulers)
      : applyNativeSchedulerBundle(fresh.schedulers as NativeSchedulerPlan[]));
  }
  options.onProgress?.("Deleting Loadout cache, library, history, and state");
  await rm(fresh.stateHome, { recursive: true, force: true });
  return {
    removedPackages: fresh.packages.length,
    removedRuntimeTools: fresh.runtimeTools.length,
  };
}

const execFileAsync = promisify(execFile);

/** Remove the globally installed npm launcher after managed data is gone. */
export async function uninstallGlobalCli(): Promise<void> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(npm, ["uninstall", "--global", "loadout-ai"], {
    windowsHide: true,
  });
}

export function formatUninstallPlan(
  plan: CompleteUninstallPlan,
  options: { applying?: boolean } = {},
): string {
  const modifiedPaths = plan.packages.flatMap((entry) =>
    entry.files
      .filter((file) => file.status === "modified")
      .map((file) => file.path),
  );
  return [
    "Complete Loadout uninstall preview",
    "",
    `Managed packages: ${plan.packages.length}`,
    `Managed runtime tools: ${plan.runtimeTools.length ? plan.runtimeTools.join(", ") : "none"}`,
    `Disabled library records: ${plan.disabledLibraryRecords}`,
    `Daily jobs to remove: ${plan.schedulers.map((item) => item.job).join(", ") || "none"}`,
    `State and cache: ${plan.stateHome}`,
    ...(plan.blocked
      ? [
          "",
          "BLOCKED: managed files were changed outside Loadout.",
          ...modifiedPaths.slice(0, 10).map((path) => `  Modified: ${path}`),
          ...(modifiedPaths.length > 10
            ? [`  …and ${modifiedPaths.length - 10} more`]
            : []),
        ]
      : []),
    "",
    ...plan.warnings.map((warning) => `Warning: ${warning}`),
    "",
    ...(options.applying
      ? [
          "Approved removal is starting. Large libraries can take several minutes; progress will be shown below.",
        ]
      : [
          "Dry run only. Re-run with `loadout uninstall --yes` to remove Loadout-managed data.",
          "Add `--remove-cli` to also uninstall the global npm command.",
        ]),
  ].join("\n");
}
