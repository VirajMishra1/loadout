import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CatalogPackage, InstallState } from "../shared/types.js";
import { writeFileAtomically } from "./atomic-file.js";
import { loadEffectiveCatalog } from "./catalog.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import { readInstallState } from "./state.js";
import { buildUpdatePlan, type UpdatePlan } from "./update.js";

export type FreshnessAlertKind =
  | "archived"
  | "materially-stale"
  | "reviewed-commit-changed"
  | "permission-expansion"
  | "outperformed";

export interface FreshnessAlert {
  id: string;
  packageId: string;
  kind: FreshnessAlertKind;
  severity: "info" | "warning" | "critical";
  message: string;
  evidence: string[];
  actions: string[];
  ignored: boolean;
}

interface AlertDecisions {
  schemaVersion: 1;
  ignored: Array<{ id: string; ignoredAt: string }>;
  replacementPins: Array<{
    packageId: string;
    replacementPackageId: string;
    pinnedAt: string;
  }>;
}

export interface ReplacementEvidence {
  installedPackageId: string;
  replacementPackageId: string;
  /** Positive only after a signed, category-scoped evaluation result is reviewed. */
  scoreDelta: number;
  evidenceId: string;
}

const decisionsPath = (): string => join(loadoutHome(), "alert-decisions.json");

function alertId(
  packageId: string,
  kind: FreshnessAlertKind,
  evidence: string,
): string {
  return `${packageId}-${kind}-${createHash("sha256")
    .update(evidence)
    .digest("hex")
    .slice(0, 10)}`;
}

async function readDecisions(): Promise<AlertDecisions> {
  try {
    const value = JSON.parse(
      await readFile(decisionsPath(), "utf8"),
    ) as AlertDecisions;
    if (
      value.schemaVersion !== 1 ||
      !Array.isArray(value.ignored) ||
      value.ignored.some(
        (item) =>
          !item ||
          typeof item.id !== "string" ||
          typeof item.ignoredAt !== "string",
      ) ||
      (value.replacementPins !== undefined &&
        (!Array.isArray(value.replacementPins) ||
          value.replacementPins.some(
            (item) =>
              !item ||
              typeof item.packageId !== "string" ||
              typeof item.replacementPackageId !== "string" ||
              typeof item.pinnedAt !== "string",
          )))
    )
      throw new Error("alert decision schema is invalid");
    return { ...value, replacementPins: value.replacementPins ?? [] };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return { schemaVersion: 1, ignored: [], replacementPins: [] };
    throw error;
  }
}

function packageAlerts(
  state: InstallState,
  catalog: CatalogPackage[],
  updates: UpdatePlan[],
  replacementEvidence: ReplacementEvidence[],
  now: Date,
): FreshnessAlert[] {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const catalogByRepository = new Map(
    catalog.map((item) => [item.repository.toLowerCase(), item]),
  );
  return state.installs.flatMap((install): FreshnessAlert[] => {
    const pkg =
      catalogById.get(install.packageId) ??
      (install.repository
        ? catalogByRepository.get(install.repository.toLowerCase())
        : undefined);
    if (!pkg) return [];
    const alerts: FreshnessAlert[] = [];
    if (pkg.archived) {
      const evidence = `${pkg.repository} is archived in current GitHub metadata`;
      alerts.push({
        id: alertId(install.packageId, "archived", evidence),
        packageId: install.packageId,
        kind: "archived",
        severity: "critical",
        message: "The installed source is archived.",
        evidence: [evidence],
        actions: [
          `loadout compare ${install.packageId}`,
          `loadout disable ${install.packageId}`,
        ],
        ignored: false,
      });
    }
    if (pkg.pushedAt) {
      const ageDays = Math.floor(
        (now.getTime() - Date.parse(pkg.pushedAt)) / 86_400_000,
      );
      if (ageDays >= 365 && !pkg.archived) {
        const evidence = `last code push was ${ageDays} days ago (${pkg.pushedAt})`;
        alerts.push({
          id: alertId(install.packageId, "materially-stale", evidence),
          packageId: install.packageId,
          kind: "materially-stale",
          severity: "warning",
          message:
            "The installed source is materially stale by the disclosed one-year heuristic.",
          evidence: [evidence],
          actions: [
            `loadout compare ${install.packageId}`,
            `loadout alert-ignore <alert-id>`,
          ],
          ignored: false,
        });
      }
    }
    if (
      install.resolvedCommit &&
      pkg.source?.commit &&
      install.resolvedCommit.toLowerCase() !== pkg.source.commit.toLowerCase()
    ) {
      const evidence = `installed ${install.resolvedCommit.slice(0, 12)}; reviewed catalog ${pkg.source.commit.slice(0, 12)}`;
      alerts.push({
        id: alertId(install.packageId, "reviewed-commit-changed", evidence),
        packageId: install.packageId,
        kind: "reviewed-commit-changed",
        severity: "info",
        message: "A different reviewed catalog commit is available.",
        evidence: [evidence],
        actions: [
          `loadout update --package ${install.packageId}`,
          `loadout compare ${install.packageId}`,
        ],
        ignored: false,
      });
    }
    const update = updates.find(
      (item) =>
        item.packageId === install.packageId &&
        item.status === "update-available" &&
        item.approvalRequired,
    );
    if (update) {
      const categories = [
        ...new Set((update.safetyFindings ?? []).map((item) => item.category)),
      ];
      const evidence = `update safety findings: ${categories.join(", ") || "manual approval required"}`;
      alerts.push({
        id: alertId(install.packageId, "permission-expansion", evidence),
        packageId: install.packageId,
        kind: "permission-expansion",
        severity: "warning",
        message:
          "The available update adds or changes safety-sensitive behavior.",
        evidence: [evidence],
        actions: [`loadout update --package ${install.packageId}`],
        ignored: false,
      });
    }
    for (const evidence of replacementEvidence.filter(
      (item) =>
        item.installedPackageId === install.packageId && item.scoreDelta > 0,
    )) {
      const replacement = catalogById.get(evidence.replacementPackageId);
      if (!replacement) continue;
      const proof = `signed evidence ${evidence.evidenceId} reports ${replacement.id} ahead by ${evidence.scoreDelta.toFixed(2)} points in its declared category`;
      alerts.push({
        id: alertId(install.packageId, "outperformed", proof),
        packageId: install.packageId,
        kind: "outperformed",
        severity: "info",
        message: `${replacement.displayName} has stronger reviewed evaluation evidence for a declared category.`,
        evidence: [proof],
        actions: [
          `loadout compare ${install.packageId}`,
          `loadout alert-pin ${install.packageId} ${replacement.id}`,
        ],
        ignored: false,
      });
    }
    return alerts;
  });
}

export async function buildFreshnessAlerts(
  options: {
    catalog?: CatalogPackage[];
    state?: InstallState;
    updates?: UpdatePlan[];
    replacementEvidence?: ReplacementEvidence[];
    checkUpdates?: boolean;
    now?: Date;
  } = {},
): Promise<FreshnessAlert[]> {
  const [catalog, state, updates, decisions] = await Promise.all([
    options.catalog ?? loadEffectiveCatalog(),
    options.state ?? readInstallState(),
    options.updates ??
      (options.checkUpdates ? buildUpdatePlan() : Promise.resolve([])),
    readDecisions(),
  ]);
  const ignored = new Set(decisions.ignored.map((item) => item.id));
  return packageAlerts(
    state,
    catalog,
    updates,
    options.replacementEvidence ?? [],
    options.now ?? new Date(),
  ).map((alert) => ({ ...alert, ignored: ignored.has(alert.id) }));
}

export async function ignoreFreshnessAlert(id: string): Promise<void> {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error("Invalid alert id");
  const decisions = await readDecisions();
  decisions.ignored = [
    ...decisions.ignored.filter((item) => item.id !== id),
    { id, ignoredAt: new Date().toISOString() },
  ].slice(-1000);
  await ensureDirectory(dirname(decisionsPath()));
  await writeFileAtomically(
    decisionsPath(),
    `${JSON.stringify(decisions, null, 2)}\n`,
  );
}

function validPackageId(value: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value))
    throw new Error("Invalid package id");
}

/** Record an explicit local replacement preference; this never changes an active set. */
export async function pinReplacement(
  packageId: string,
  replacementPackageId: string,
  options: { catalog?: CatalogPackage[]; state?: InstallState } = {},
): Promise<void> {
  validPackageId(packageId);
  validPackageId(replacementPackageId);
  if (packageId === replacementPackageId)
    throw new Error("A package cannot replace itself");
  const [catalog, state] = await Promise.all([
    options.catalog ?? loadEffectiveCatalog(),
    options.state ?? readInstallState(),
  ]);
  if (!state.installs.some((install) => install.packageId === packageId))
    throw new Error(`Package '${packageId}' is not installed`);
  const current = catalog.find((pkg) => pkg.id === packageId);
  const replacement = catalog.find((pkg) => pkg.id === replacementPackageId);
  if (!current)
    throw new Error(
      `Installed package '${packageId}' is not in the reviewed catalog`,
    );
  if (!replacement)
    throw new Error(
      `Replacement '${replacementPackageId}' is not in the reviewed catalog`,
    );
  if (current.category !== replacement.category)
    throw new Error(
      `Replacement categories differ (${current.category} vs ${replacement.category}); compare related capabilities only`,
    );
  const decisions = await readDecisions();
  decisions.replacementPins = [
    ...decisions.replacementPins.filter((item) => item.packageId !== packageId),
    { packageId, replacementPackageId, pinnedAt: new Date().toISOString() },
  ];
  await ensureDirectory(dirname(decisionsPath()));
  await writeFileAtomically(
    decisionsPath(),
    `${JSON.stringify(decisions, null, 2)}\n`,
  );
}

export async function unpinReplacement(packageId: string): Promise<boolean> {
  validPackageId(packageId);
  const decisions = await readDecisions();
  const replacementPins = decisions.replacementPins.filter(
    (item) => item.packageId !== packageId,
  );
  const changed = replacementPins.length !== decisions.replacementPins.length;
  if (!changed) return false;
  decisions.replacementPins = replacementPins;
  await ensureDirectory(dirname(decisionsPath()));
  await writeFileAtomically(
    decisionsPath(),
    `${JSON.stringify(decisions, null, 2)}\n`,
  );
  return true;
}

export async function readReplacementPins(): Promise<
  AlertDecisions["replacementPins"]
> {
  return (await readDecisions()).replacementPins;
}

export function formatFreshnessAlerts(alerts: FreshnessAlert[]): string {
  const visible = alerts.filter((alert) => !alert.ignored);
  if (!visible.length)
    return alerts.length
      ? "No unignored freshness alerts."
      : "No freshness or replacement alert is supported by current evidence.";
  return [
    `Freshness alerts: ${visible.length}`,
    ...visible.flatMap((alert) => [
      `${alert.severity === "critical" ? "✗" : alert.severity === "warning" ? "!" : "•"} ${alert.id}: ${alert.packageId} — ${alert.message}`,
      `  Evidence: ${alert.evidence.join("; ")}`,
      `  Actions: ${alert.actions.join(" | ")}`,
    ]),
  ].join("\n");
}
