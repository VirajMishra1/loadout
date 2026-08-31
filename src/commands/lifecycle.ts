import { Command } from "commander";
import {
  loadEffectiveCatalog,
  type InstallSelectionMode,
} from "../core/catalog/catalog.js";
import { detectAgents, parseAgentSelection } from "../core/agents/paths.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildSkillPlan,
  applySkillInstall,
  installedAgents,
} from "../core/install/install.js";
import {
  listSnapshotIds,
  readSnapshot,
  restoreSnapshot,
  summarizeSnapshot,
} from "../core/install/snapshot.js";
import { fetchRepositorySnapshot } from "../core/install/source.js";

import {
  applyPackageUpdate,
  buildUpdatePlan,
  formatUpdatePlan,
  selectSafeAutomaticUpdates,
} from "../core/install/update.js";

import { readInstallState } from "../core/workspace/state.js";

import {
  evaluateInstalledProfile,
  formatInstalledProfileStatus,
} from "../core/workspace/profile-state.js";

import { resolveCatalogProfile } from "../core/catalog/profiles.js";

import {
  compileConversion,
  type ConversionKind,
  type ConversionTarget,
} from "../core/agents/conversion.js";
import { writeFileAtomically } from "../core/install/atomic-file.js";
import {
  applyPreparedCatalogInstall,
  formatCatalogApplyGuidance,
  formatPreparedCatalogInstall,
  prepareCatalogInstall,
} from "../core/install/catalog-install.js";

import { withMutationLock } from "../core/install/transaction.js";

import { setupSelection, printSetupProgress } from "./support.js";

export function registerLifecycle(program: Command): void {
  program
    .command("plan")
    .description(
      "Plan installing packages from a local directory, catalog, or public GitHub repository",
    )
    .option(
      "--source <directory>",
      "local package directory containing SKILL.md",
    )
    .option(
      "--repository <owner/repo>",
      "public GitHub repository containing SKILL.md",
    )
    .option(
      "--package <id>",
      "package identifier (repeat for custom mode)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option(
      "--mode <mode>",
      "catalog selection mode: stable, power, maximum, or custom",
    )
    .option(
      "--agents <ids>",
      "comma-separated agent ids; defaults to all detected agents",
    )
    .action(
      async (options: {
        source?: string;
        repository?: string;
        package: string[];
        mode?: string;
        agents?: string;
      }) => {
        const packageIds = options.package ?? [];
        const hasSource = Boolean(options.source || options.repository);
        if (hasSource && options.mode)
          throw new Error(
            "--mode cannot be combined with --source or --repository",
          );
        if (hasSource && packageIds.length !== 1)
          throw new Error(
            "A source or repository requires exactly one --package",
          );
        if (!hasSource && !options.mode)
          throw new Error(
            "Provide --mode or exactly one of --source/--repository",
          );
        if (!hasSource) {
          const prepared = await prepareCatalogInstall(
            setupSelection(options.mode!, packageIds),
            {
              requestedAgents: parseAgentSelection(options.agents),
              onProgress: printSetupProgress,
            },
          );
          console.log(
            JSON.stringify(
              {
                mode: prepared.selection.mode,
                agents: prepared.agents.map((agent) => agent.id),
                packages: prepared.entries.map((entry) => ({
                  ...entry.plan,
                  repository: entry.metadata?.repository,
                  resolvedCommit: entry.metadata?.resolvedCommit,
                  safety: entry.safety,
                })),
                skipped: prepared.skipped,
                profile: {
                  deferred: prepared.resolution.deferred.map((pkg) => pkg.id),
                  conflicts: prepared.resolution.conflicts,
                  warnings: prepared.resolution.warnings,
                },
              },
              null,
              2,
            ),
          );
          return;
        }
        const resolution = hasSource
          ? undefined
          : resolveCatalogProfile(await loadEffectiveCatalog(), {
              mode: options.mode as InstallSelectionMode,
              packageIds,
            });
        const selected = hasSource
          ? [{ id: packageIds[0] }]
          : resolution!.packages;
        const agents = installedAgents(
          await detectAgents(),
          parseAgentSelection(options.agents),
        );
        const plans = [];
        const skipped: Array<{ packageId: string; reason: string }> = [];
        for (const pkg of selected) {
          const fetched = options.repository
            ? await fetchRepositorySnapshot(options.repository)
            : !options.source
              ? await fetchRepositorySnapshot(
                  (pkg as { repository: string }).repository,
                )
              : undefined;
          try {
            plans.push(
              await buildSkillPlan(
                fetched?.path ?? options.source!,
                pkg.id,
                agents,
              ),
            );
          } catch (error) {
            if (
              !options.mode ||
              !(error instanceof Error) ||
              !error.message.startsWith("No SKILL.md found")
            )
              throw error;
            skipped.push({
              packageId: pkg.id,
              reason:
                "No SKILL.md found; this package is not skill-installable yet (inspect its MCP manifest instead).",
            });
          }
        }
        console.log(
          JSON.stringify(
            options.mode
              ? {
                  mode: options.mode,
                  packages: plans,
                  skipped,
                  profile: resolution && {
                    deferred: resolution.deferred.map((pkg) => pkg.id),
                    conflicts: resolution.conflicts,
                    warnings: resolution.warnings,
                  },
                }
              : plans[0],
            null,
            2,
          ),
        );
      },
    );

  program
    .command("install")
    .description(
      "Install packages from a local directory, catalog, or public GitHub repository",
    )
    .option(
      "--source <directory>",
      "local package directory containing SKILL.md",
    )
    .option(
      "--repository <owner/repo>",
      "public GitHub repository containing SKILL.md",
    )
    .option(
      "--package <id>",
      "package identifier (repeat for custom mode)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option(
      "--mode <mode>",
      "catalog selection mode: stable, power, maximum, or custom",
    )
    .option(
      "--agents <ids>",
      "comma-separated agent ids; defaults to all detected agents",
    )
    .option("--yes", "apply without interactive confirmation")
    .option(
      "--approve-risk",
      "approve reviewed safety findings for catalog mode",
    )
    .option("--details", "show every quarantined and deferred unit")
    .action(
      async (options: {
        source?: string;
        repository?: string;
        package: string[];
        mode?: string;
        agents?: string;
        yes?: boolean;
        approveRisk?: boolean;
        details?: boolean;
      }) => {
        const packageIds = options.package ?? [];
        const hasSource = Boolean(options.source || options.repository);
        if (hasSource && options.mode)
          throw new Error(
            "--mode cannot be combined with --source or --repository",
          );
        if (hasSource && packageIds.length !== 1)
          throw new Error(
            "A source or repository requires exactly one --package",
          );
        if (!hasSource && !options.mode)
          throw new Error(
            "Provide --mode or exactly one of --source/--repository",
          );
        if (!hasSource) {
          const prepared = await prepareCatalogInstall(
            setupSelection(options.mode!, packageIds),
            {
              requestedAgents: parseAgentSelection(options.agents),
              onProgress: printSetupProgress,
              additive: options.mode === "custom",
            },
          );
          console.log(
            formatPreparedCatalogInstall(prepared, {
              details: options.details,
            }),
          );
          if (!options.yes) {
            console.log(
              formatCatalogApplyGuidance(
                prepared.entries.some((entry) => entry.safety.approvalRequired),
              ),
            );
            return;
          }
          const snapshotId = await applyPreparedCatalogInstall(prepared, {
            approveRisk: options.approveRisk,
          });
          console.log(
            `Installed ${prepared.entries.length} repositories as one transaction. Snapshot: ${snapshotId}`,
          );
          return;
        }
        const resolution = hasSource
          ? undefined
          : resolveCatalogProfile(await loadEffectiveCatalog(), {
              mode: options.mode as InstallSelectionMode,
              packageIds,
            });
        const selected = hasSource
          ? [{ id: packageIds[0] }]
          : resolution!.packages;
        const agents = installedAgents(
          await detectAgents(),
          parseAgentSelection(options.agents),
        );
        const plans: Array<{
          plan: Awaited<ReturnType<typeof buildSkillPlan>>;
          repository?: string;
          commit?: string;
        }> = [];
        const skipped: Array<{ packageId: string; reason: string }> = [];
        for (const pkg of selected) {
          const fetched = options.repository
            ? await fetchRepositorySnapshot(options.repository)
            : !options.source
              ? await fetchRepositorySnapshot(
                  (pkg as { repository: string }).repository,
                )
              : undefined;
          try {
            plans.push({
              plan: await buildSkillPlan(
                fetched?.path ?? options.source!,
                pkg.id,
                agents,
              ),
              repository: fetched?.repository,
              commit: fetched?.commit,
            });
          } catch (error) {
            if (
              !options.mode ||
              !(error instanceof Error) ||
              !error.message.startsWith("No SKILL.md found")
            )
              throw error;
            skipped.push({
              packageId: pkg.id,
              reason:
                "No SKILL.md found; this package is not skill-installable yet (inspect its MCP manifest instead).",
            });
          }
        }
        console.log(
          `Installing ${plans.map(({ plan }) => plan.packageId).join(", ")} for ${agents.map((agent) => agent.id).join(", ")}...`,
        );
        for (const warning of resolution?.warnings ?? [])
          console.log(`Profile warning: ${warning}`);
        for (const entry of skipped)
          console.log(`Skipping ${entry.packageId}: ${entry.reason}`);
        if (!options.yes)
          console.log(
            "Review the plan with `loadout plan`; use --yes to apply it.",
          );
        if (!options.yes) return;
        for (const entry of plans) {
          const snapshotId = await applySkillInstall(
            entry.plan,
            entry.repository
              ? { repository: entry.repository, resolvedCommit: entry.commit }
              : undefined,
          );
          console.log(
            `Installed ${entry.plan.packageId} successfully. Snapshot: ${snapshotId}`,
          );
        }
      },
    );

  program
    .command("rollback")
    .description("Restore the most recent Loadout snapshot")
    .option("--snapshot <id>", "specific snapshot id")
    .option("--list", "list snapshot ids without restoring anything")
    .action(async (options: { snapshot?: string; list?: boolean }) => {
      if (options.list) {
        const snapshotIds = await listSnapshotIds();
        if (!snapshotIds.length)
          return console.log("No Loadout snapshots found.");
        console.log("Loadout rollback history (oldest to newest):");
        for (const [index, id] of snapshotIds.entries()) {
          const summary = summarizeSnapshot(await readSnapshot(id));
          const impact =
            summary.changedEntries === undefined
              ? "legacy impact unknown"
              : `${summary.changedEntries} changed filesystem entr${summary.changedEntries === 1 ? "y" : "ies"}`;
          console.log(
            `${index === snapshotIds.length - 1 ? "latest" : "      "}  ${summary.createdAt}  ${summary.label}  ${impact}  ${summary.roots} root(s)  ${id}`,
          );
        }
        console.log(
          "Restore an exact entry with: loadout rollback --snapshot <id>",
        );
        return;
      }
      const selected = await withMutationLock(async () => {
        const snapshotIds = await listSnapshotIds();
        const chosen = options.snapshot ?? snapshotIds.at(-1);
        if (!chosen) throw new Error("No Loadout snapshots found");
        const snapshot = await readSnapshot(chosen);
        await restoreSnapshot(snapshot, {
          requireUnchangedPostMutationState: true,
        });
        return summarizeSnapshot(snapshot);
      });
      console.log(
        `Restored ${selected.label} snapshot ${selected.id} (${selected.changedEntries ?? "unknown"} recorded changed filesystem entries across ${selected.roots} root(s)).`,
      );
      if (selected.changedEntries === 0)
        console.log(
          "This snapshot recorded no effective filesystem change. Choose an older explicit snapshot if you meant to undo an earlier installation.",
        );
    });

  program
    .command("update")
    .description(
      "Check the saved profile and every managed package for updates",
    )
    .option("--json", "emit machine-readable JSON")
    .option(
      "--yes",
      "apply reviewed profile drift and safe screened package updates",
    )
    .option("--apply", "legacy alias for --yes with --package")
    .option("--package <id>", "managed package id to update")
    .option(
      "--approve-risk",
      "explicitly approve an update containing blocked safety findings",
    )
    .action(
      async (options: {
        json?: boolean;
        yes?: boolean;
        apply?: boolean;
        package?: string;
        approveRisk?: boolean;
      }) => {
        const applying = Boolean(options.apply || options.yes);
        if (options.apply && !options.package)
          throw new Error("--apply requires --package <id>");
        if (applying && options.package) {
          const result = await applyPackageUpdate(options.package, {
            approveRisk: options.approveRisk,
          });
          console.log(
            options.json
              ? JSON.stringify(
                  { packageId: options.package, ...result },
                  null,
                  2,
                )
              : `Updated ${options.package} to ${result.commit}. Snapshot: ${result.snapshotId}`,
          );
          return;
        }
        const catalog = await loadEffectiveCatalog();
        let profile = await evaluateInstalledProfile(catalog);
        let profileSnapshotId: string | undefined;
        const appliedPackages: string[] = [];
        const failedPackages: Array<{ packageId: string; error: string }> = [];
        if (applying && profile.installed && profile.needsRefresh) {
          const saved = (await readInstallState()).profile!;
          const prepared = await prepareCatalogInstall(
            {
              mode: saved.mode,
              ...(saved.packageIds ? { packageIds: saved.packageIds } : {}),
            },
            {
              requestedAgents: saved.agents,
              catalog,
              access: { modelApis: [] },
              onProgress: printSetupProgress,
            },
          );
          profileSnapshotId = await applyPreparedCatalogInstall(prepared, {
            approveRisk: options.approveRisk,
          });
          if (!options.json)
            console.log(
              `Applied reviewed ${saved.mode} profile changes. Snapshot: ${profileSnapshotId}`,
            );
          profile = await evaluateInstalledProfile(catalog);
        }
        if (!options.json)
          console.error(
            "Checking repository commits (4 at a time; changed sources may take up to 120s for safety review)…",
          );
        let plans = await buildUpdatePlan(undefined, {
          packageId: options.package,
          onProgress: options.json
            ? undefined
            : ({ completed, total, packageId }) =>
                console.error(`✓ [${completed}/${total}] ${packageId}`),
        });
        if (options.package && plans.length === 0)
          throw new Error(
            `No Loadout-managed installation named '${options.package}' was found. Run \`loadout list\` to see tracked packages.`,
          );
        if (applying) {
          const safe = selectSafeAutomaticUpdates(plans);
          for (const plan of safe)
            try {
              await applyPackageUpdate(plan.packageId);
              appliedPackages.push(plan.packageId);
            } catch (error) {
              failedPackages.push({
                packageId: plan.packageId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          plans = await buildUpdatePlan(undefined, {
            onProgress: options.json
              ? undefined
              : ({ completed, total, packageId }) =>
                  console.error(`✓ [${completed}/${total}] ${packageId}`),
          });
          if (!options.json) {
            console.log(
              appliedPackages.length
                ? `Updated safely: ${appliedPackages.join(", ")}`
                : "No safe active package update needed applying.",
            );
            for (const item of failedPackages)
              console.log(`Could not update ${item.packageId}: ${item.error}`);
            const held = plans.filter(
              (plan) =>
                plan.status === "update-available" &&
                (plan.approvalRequired || plan.disabledAgents?.length),
            );
            if (held.length)
              console.log(
                `Held for explicit review: ${held.map((item) => item.packageId).join(", ")}`,
              );
          }
        }
        console.log(
          options.json
            ? JSON.stringify(
                {
                  profile,
                  packages: plans,
                  ...(applying
                    ? {
                        applied: {
                          profileSnapshotId,
                          packages: appliedPackages,
                          failures: failedPackages,
                        },
                      }
                    : {}),
                },
                null,
                2,
              )
            : `${formatInstalledProfileStatus(profile)}\n\n${formatUpdatePlan(plans)}`,
        );
      },
    );

  program
    .command("convert")
    .description(
      "Convert a subagent or hook into a static, loss-reported artifact",
    )
    .requiredOption("--kind <kind>", "subagent or hook")
    .requiredOption(
      "--target <target>",
      "codex-skill, claude-skill, or static-review",
    )
    .requiredOption("--name <name>", "source component name")
    .requiredOption("--input <path>", "UTF-8 instruction or hook source file")
    .requiredOption("--output <directory>", "artifact output directory")
    .option("--yes", "write the artifact; otherwise preview only")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (options: {
        kind: string;
        target: string;
        name: string;
        input: string;
        output: string;
        yes?: boolean;
        json?: boolean;
      }) => {
        const kinds: ConversionKind[] = ["subagent", "hook"];
        const targets: ConversionTarget[] = [
          "codex-skill",
          "claude-skill",
          "static-review",
        ];
        if (!kinds.includes(options.kind as ConversionKind))
          throw new Error("--kind must be subagent or hook");
        if (!targets.includes(options.target as ConversionTarget))
          throw new Error(
            "--target must be codex-skill, claude-skill, or static-review",
          );
        const result = compileConversion(
          {
            kind: options.kind as ConversionKind,
            name: options.name,
            body: await readFile(options.input, "utf8"),
          },
          options.target as ConversionTarget,
        );
        const destination = resolve(options.output, result.relativePath);
        if (options.yes)
          await writeFileAtomically(destination, result.content, 0o600);
        const report = {
          ...result,
          ...(options.yes
            ? { destination }
            : { destination, write: "preview-only" as const }),
        };
        console.log(
          options.json
            ? JSON.stringify(report, null, 2)
            : `${options.yes ? "Wrote" : "Previewed"} ${destination}.\n` +
                `Preserved: ${result.preserved.join(", ")}. Dropped: ${result.dropped.length} field(s).\n` +
                (result.requiresApproval
                  ? "Manual approval is required before using this artifact."
                  : "No additional approval is required."),
        );
      },
    );
}
