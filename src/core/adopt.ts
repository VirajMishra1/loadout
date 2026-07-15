import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { DetectedAgent, InstallPlan } from "../shared/types.js";
import type { CatalogSkillIndex, SkillProvenance } from "./provenance.js";
import { enrichInventoryWithProvenance } from "./provenance.js";
import { scanInstalledSkills } from "./skill-inventory.js";
import { installStatePath, recordInstall } from "./state.js";
import { createSnapshot } from "./snapshot.js";
import {
  beginTransaction,
  completeTransaction,
  markTransactionCommitting,
  recoverPendingTransactions,
  rollbackTransaction,
} from "./transaction.js";

export interface AdoptionPlan {
  packageId: string;
  agent: DetectedAgent;
  name: string;
  path: string;
  fingerprint: string;
  provenance: SkillProvenance;
  reviewed: boolean;
  repository?: string;
  resolvedCommit?: string;
  installPlan: InstallPlan;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "skill"
  );
}

export async function planSkillAdoption(
  skill: string,
  agent: DetectedAgent,
  index?: CatalogSkillIndex,
): Promise<AdoptionPlan> {
  const inventory = enrichInventoryWithProvenance(
    await scanInstalledSkills([agent]),
    index,
    index ? "cache" : "none",
  );
  const query = skill.trim().toLowerCase();
  const matches = inventory.skills.filter(
    (entry) =>
      entry.name.toLowerCase() === query ||
      basename(entry.path).toLowerCase() === query ||
      entry.path === skill,
  );
  if (!matches.length)
    throw new Error(
      `No installed skill named '${skill}' was found for ${agent.displayName}`,
    );
  if (matches.length > 1)
    throw new Error(
      `Skill '${skill}' is ambiguous for ${agent.displayName}: ${matches.map((entry) => entry.path).join(", ")}`,
    );
  const match = matches[0];
  if (match.managed)
    throw new Error(
      `Skill '${skill}' is already managed as ${match.packageId}`,
    );
  const exact =
    match.provenance.kind === "catalog-exact"
      ? match.provenance.candidates[0]
      : undefined;
  const packageId = `adopted-${agent.id}-${slug(match.name)}`;
  return {
    packageId,
    agent,
    name: match.name,
    path: match.path,
    fingerprint: match.fingerprint,
    provenance: match.provenance,
    reviewed: Boolean(exact),
    ...(exact
      ? { repository: exact.repository, resolvedCommit: exact.commit }
      : {}),
    installPlan: {
      packageId,
      targetAgents: [agent.id],
      warnings: exact
        ? []
        : [
            "The installed bytes do not exactly match the reviewed catalog; adoption records ownership but does not mark them reviewed.",
          ],
      files: [
        {
          source: match.path,
          target: match.path,
          targetAgent: agent.id,
          componentType: "skill",
          compatibility: "native",
          skillName: match.name,
        },
      ],
    },
  };
}

export async function applySkillAdoption(plan: AdoptionPlan): Promise<string> {
  const current = createHash("sha256")
    .update(await readFile(join(plan.path, "SKILL.md")))
    .digest("hex");
  if (current !== plan.fingerprint)
    throw new Error(
      "The skill changed after preview; scan again before adopting it.",
    );
  await recoverPendingTransactions();
  const targets = [installStatePath()];
  const snapshot = await createSnapshot(targets);
  const transaction = await beginTransaction(snapshot, targets);
  try {
    await markTransactionCommitting(transaction);
    await recordInstall(plan.installPlan, snapshot.id, {
      ...(plan.repository ? { repository: plan.repository } : {}),
      ...(plan.resolvedCommit ? { resolvedCommit: plan.resolvedCommit } : {}),
      reviewed: plan.reviewed,
    });
    await completeTransaction(transaction);
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
  return snapshot.id;
}

export function formatAdoptionPlan(plan: AdoptionPlan): string {
  return [
    `Adopt: ${plan.name} for ${plan.agent.displayName}`,
    `Path: ${plan.path}`,
    `Managed id: ${plan.packageId}`,
    `Provenance: ${plan.provenance.kind} (${plan.provenance.confidence})`,
    `Review state: ${plan.reviewed ? "reviewed exact catalog match" : "unreviewed"}`,
    ...plan.installPlan.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");
}
