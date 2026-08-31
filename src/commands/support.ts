import { createInterface } from "node:readline/promises";
import { createRequire } from "node:module";
import { type InstallSelectionMode } from "../core/catalog.js";
import { detectAgents, parseAgentSelection } from "../core/paths.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type McpSetupRecipe } from "../core/mcp-recipes.js";
import type { CredentialReference } from "../shared/types.js";

import {
  applyPreparedCatalogInstall,
  formatCatalogApplyGuidance,
  formatPreparedCatalogInstall,
  prepareCatalogInstall,
  type CatalogInstallProgress,
  type PreparedCatalogInstall,
} from "../core/catalog-install.js";
import {
  formatInstalledSkillInventory,
  scanInstalledSkills,
} from "../core/skill-inventory.js";
import { type CatalogSkillIndexProgress } from "../core/provenance.js";

import {
  interactiveModelApiAccess,
  parseModelApiAccess,
  type SetupAccessProfile,
} from "../core/access.js";

import { BEGINNER_GUIDE } from "../core/cli-guide.js";

export const collectOption = (
  value: string,
  previous: string[] = [],
): string[] => [...previous, value];

export function parseMcpCredentialMappings(
  recipe: McpSetupRecipe,
  mappings: string[],
  account?: string,
): Record<string, CredentialReference> {
  const references: Record<string, CredentialReference> = {};
  for (const mapping of mappings) {
    const separator = mapping.indexOf("=");
    if (separator <= 0)
      throw new Error(
        "Invalid --credential mapping; expected NAME=env:VARIABLE or NAME=keychain:SERVICE. Never pass a credential value.",
      );
    const name = mapping.slice(0, separator);
    const value = mapping.slice(separator + 1);
    if (!recipe.environment.includes(name))
      throw new Error(
        `Credential '${name}' is not required by recipe '${recipe.id}'`,
      );
    if (references[name])
      throw new Error(`Credential '${name}' was mapped more than once`);
    if (value.startsWith("env:") && value.length > 4)
      references[name] = {
        kind: "environment",
        name: value.slice(4),
      };
    else if (value.startsWith("keychain:") && value.length > 9)
      references[name] = {
        kind: "os-keychain",
        service: value.slice(9),
        ...(account ? { account } : {}),
      };
    else
      throw new Error(
        `Invalid --credential mapping for '${name}'; use env:VARIABLE or keychain:SERVICE, never a credential value.`,
      );
  }
  return references;
}

export async function readCredentialFromStdin(): Promise<string> {
  if (process.stdin.isTTY)
    throw new Error(
      "Credential input must be piped on stdin; interactive echo is intentionally unsupported",
    );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 64 * 1024)
      throw new Error("Credential input exceeds the 64 KiB safety limit");
    chunks.push(value);
  }
  const secret = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
  if (!secret) throw new Error("Credential input is empty");
  return secret;
}

export interface SetupOptions {
  mode?: string;
  agents?: string;
  package: string[];
  yes?: boolean;
  approveRisk?: boolean;
  apiAccess?: string;
  details?: boolean;
}

export function setupSelection(
  mode: string,
  packageIds: string[],
): { mode: InstallSelectionMode; packageIds?: string[] } {
  if (!(["stable", "power", "maximum", "custom"] as string[]).includes(mode))
    throw new Error("--mode must be stable, power, maximum, or custom");
  if (mode === "custom" && packageIds.length === 0)
    throw new Error("Custom setup requires at least one --package <id>");
  if (mode !== "custom" && packageIds.length)
    throw new Error("--package can only be used with --mode custom");
  return {
    mode: mode as InstallSelectionMode,
    ...(packageIds.length ? { packageIds } : {}),
  };
}

export function printSetupProgress(progress: CatalogInstallProgress): void {
  const marker =
    progress.status === "ready"
      ? "✓"
      : progress.status === "skipped"
        ? "○"
        : "↓";
  console.error(
    `${marker} [${progress.completed}/${progress.total}] ${progress.message}`,
  );
}

export function printProvenanceProgress(
  progress: CatalogSkillIndexProgress,
): void {
  const marker =
    progress.status === "ready"
      ? "✓"
      : progress.status === "failed"
        ? "○"
        : "↓";
  console.error(
    `${marker} [${progress.completed}/${progress.total}] ${progress.message}`,
  );
}

export function riskyPackageSummary(prepared: PreparedCatalogInstall): string {
  return prepared.entries
    .filter((entry) => entry.safety.approvalRequired)
    .map((entry) => {
      const categories = [
        ...new Set(entry.safety.findings.map((finding) => finding.category)),
      ];
      return `${entry.package.id} (${categories.join(", ")})`;
    })
    .join(", ");
}

export async function runSetup(options: SetupOptions): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let mode = options.mode;
  let packageIds = options.package ?? [];
  let reader: ReturnType<typeof createInterface> | undefined;
  let access: SetupAccessProfile | undefined = options.apiAccess
    ? parseModelApiAccess(options.apiAccess)
    : undefined;
  try {
    if (!mode) {
      if (!interactive) {
        console.log(
          "Pick a loadout to preview: `loadout setup --mode stable` (recommended), `--mode power` (broader), or `--mode maximum` (full library, activate per project). Nothing installs until you add --yes.",
        );
        return;
      }
      reader = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = (
        await reader.question(
          [
            "Choose a loadout:",
            "  [1] Stable   — a small, reviewed set of everyday skills (recommended)",
            "  [2] Power    — a broader daily-driver set",
            "  [3] Maximum  — download the full reviewed library, activate per project later",
            "  [4] Custom   — pick exact package ids",
            "> ",
          ].join("\n"),
        )
      ).trim();
      mode =
        answer === "2"
          ? "power"
          : answer === "3"
            ? "maximum"
            : answer === "4"
              ? "custom"
              : "stable";
      if (mode === "custom") {
        const custom = await reader.question(
          "Enter comma-separated catalog package ids: ",
        );
        packageIds = custom
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
      }
    }
    if (!access && interactive && !options.yes) {
      reader ??= createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      access = interactiveModelApiAccess(
        await reader.question(
          "Any billed model API key to declare? (ChatGPT/Claude subscriptions don't count) [0] No, [1] OpenAI, [2] Anthropic, [3] Both, [4] OpenRouter, [5] Other: ",
        ),
      );
    }
    access ??= { modelApis: [] };
    const selection = setupSelection(mode, packageIds);
    console.log(
      "\nPreparing a read-only install plan from screened immutable commits…",
    );
    const prepared = await prepareCatalogInstall(selection, {
      requestedAgents: parseAgentSelection(options.agents),
      onProgress: printSetupProgress,
      access,
    });
    console.log(
      `\n${formatPreparedCatalogInstall(prepared, { details: options.details })}\n`,
    );
    const risky = riskyPackageSummary(prepared);
    let approved = Boolean(options.yes);
    let riskApproved = Boolean(options.approveRisk);
    if (!approved) {
      if (!interactive) {
        console.log(formatCatalogApplyGuidance(Boolean(risky)));
        return;
      }
      reader ??= createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      approved = /^(?:y|yes)$/i.test(
        (
          await reader.question(
            "Install this loadout as one rollback-safe transaction? [y/N] ",
          )
        ).trim(),
      );
      if (!approved) {
        console.log("Cancelled; no agent files were changed.");
        return;
      }
    }
    if (risky && !riskApproved) {
      if (!interactive)
        throw new Error(
          `The screened skills contain additional safety findings: ${risky}. Inspect the preview and add --approve-risk to proceed.`,
        );
      reader ??= createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      console.log(`Additional safety findings: ${risky}`);
      riskApproved = /^(?:y|yes)$/i.test(
        (
          await reader.question(
            "Approve these reviewed script/domain/instruction findings? [y/N] ",
          )
        ).trim(),
      );
      if (!riskApproved) {
        console.log("Cancelled; no agent files were changed.");
        return;
      }
    }
    const snapshotId = await applyPreparedCatalogInstall(prepared, {
      approveRisk: riskApproved,
    });
    console.log(
      `\nLoadout installed ${prepared.entries.length} repositories for ${prepared.agents.length} agent(s). Snapshot: ${snapshotId}`,
    );
    console.log(
      "Next: `loadout status`, `loadout optimize --project .`, or `loadout autopilot --yes` for opt-in daily read-only discovery and update checks.",
    );
  } finally {
    reader?.close();
  }
}

/**
 * Zero-argument front door. On a TTY, bare `loadout` detects agents, shows the
 * current inventory, then hands off to the interactive setup flow. Non-TTY
 * callers never reach here (cli.ts prints the read-only guide instead), so this
 * stays safe to run without arguments in a real terminal only.
 */
export async function runWizard(): Promise<void> {
  console.log("Loadout — make your AI coding agents more capable\n");
  const detected = await detectAgents();
  const present = detected.filter((agent) => agent.installed);
  if (!present.length) {
    console.log(
      "No supported agents detected yet. Loadout works with Claude Code, Codex, Cursor,",
    );
    console.log(
      "Gemini CLI, OpenCode, and more. Install one, then run `loadout` again.\n",
    );
    printBeginnerGuide();
    return;
  }
  console.log(
    `Detected ${present.length} agent(s): ${present.map((agent) => agent.displayName).join(", ")}`,
  );
  console.log(
    formatInstalledSkillInventory(await scanInstalledSkills(present)),
  );
  console.log(
    "\nPreview first — nothing changes until you approve, and every change is snapshotted for rollback.\n",
  );
  await runSetup({ package: [] });
}

const _require = createRequire(import.meta.url);

function findPackageJson(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "package.json");
    try {
      const pkg = _require(candidate) as { name?: string };
      if (pkg.name === "loadout-ai") return candidate;
    } catch {
      // not found, keep walking
    }
    dir = dirname(dir);
  }
  // ponytail: fallback for dist layout — 3 levels up from dist/src/commands/
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "package.json",
  );
}

export const LOADOUT_VERSION: string = (
  _require(findPackageJson()) as { version: string }
).version;

export function durableSchedulerLauncher(): string[] {
  return [
    join(
      dirname(process.execPath),
      process.platform === "win32" ? "npx.cmd" : "npx",
    ),
    "--yes",
    `loadout-ai@${LOADOUT_VERSION}`,
  ];
}

export function printBeginnerGuide(): void {
  console.log(BEGINNER_GUIDE);
}
