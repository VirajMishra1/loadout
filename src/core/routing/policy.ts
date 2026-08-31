import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentId } from "../../shared/types.js";
import { writeFileAtomically } from "../install/atomic-file.js";
import { ensureDirectory, loadoutHome } from "../agents/paths.js";
import { MODEL_CATALOG, type ModelEntry } from "./route.js";

/**
 * Three buckets, not six phases. "Is this hard, ordinary, or throwaway?" is a
 * judgment a person or an agent can actually make about a task. "Is this the
 * document phase?" is not, which is why keyword classification into six phases
 * produced advice nobody trusted.
 */
export type Bucket = "hard" | "normal" | "cheap";

export const BUCKETS: readonly Bucket[] = ["hard", "normal", "cheap"];

export const BUCKET_MEANING: Record<Bucket, string> = {
  hard: "architecture, security, migrations, tricky debugging, risky review",
  normal: "most implementation, ordinary debugging, refactors",
  cheap: "tests, docs, boilerplate, renames, mechanical edits",
};

export interface RoutingPolicy {
  version: 1;
  /** Model id per bucket. Edit freely; this is your policy, not Loadout's. */
  rules: Record<Bucket, string>;
}

export const policyPath = (): string => join(loadoutHome(), "routing.json");

/**
 * Defaults reflect a deliberate stance: on Claude the real choice is Opus or
 * Sonnet, and the cheapest useful tier lives on Codex. Anyone who disagrees
 * edits the file rather than arguing with a hardcoded table.
 */
export function defaultPolicy(installed: AgentId[] = []): RoutingPolicy {
  const hasCodex = installed.length === 0 || installed.includes("codex");
  return {
    version: 1,
    rules: {
      hard: "claude-opus-5",
      normal: "claude-sonnet-5",
      // Without Codex there is no fast tier to fall back to.
      cheap: hasCodex ? "gpt-5.6-luna" : "claude-sonnet-5",
    },
  };
}

export function findModel(id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((model) => model.id === id);
}

export function validatePolicy(value: unknown): RoutingPolicy {
  const candidate = value as Partial<RoutingPolicy>;
  if (!candidate || candidate.version !== 1)
    throw new Error("Routing policy must have version 1");
  const rules = candidate.rules;
  if (!rules) throw new Error("Routing policy has no rules");
  for (const bucket of BUCKETS) {
    const id = rules[bucket];
    if (typeof id !== "string" || !id)
      throw new Error(`Routing policy is missing a model for '${bucket}'`);
    if (!findModel(id))
      throw new Error(
        `Routing policy names unknown model '${id}' for '${bucket}'. Run 'loadout route --models' to list valid ids.`,
      );
  }
  return { version: 1, rules: { ...rules } as Record<Bucket, string> };
}

export async function readPolicy(
  installed: AgentId[] = [],
): Promise<{ policy: RoutingPolicy; source: "file" | "default" }> {
  try {
    const raw = await readFile(policyPath(), "utf8");
    return { policy: validatePolicy(JSON.parse(raw)), source: "file" };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "ENOENT"
    )
      return { policy: defaultPolicy(installed), source: "default" };
    throw error;
  }
}

export async function writePolicy(policy: RoutingPolicy): Promise<string> {
  const path = policyPath();
  await ensureDirectory(dirname(path));
  await writeFileAtomically(path, `${JSON.stringify(policy, null, 2)}\n`);
  return path;
}

export async function setRule(
  bucket: Bucket,
  modelId: string,
  installed: AgentId[] = [],
): Promise<RoutingPolicy> {
  if (!findModel(modelId))
    throw new Error(
      `Unknown model '${modelId}'. Run 'loadout route --models' to list valid ids.`,
    );
  const { policy } = await readPolicy(installed);
  const next = validatePolicy({
    version: 1,
    rules: { ...policy.rules, [bucket]: modelId },
  });
  await writePolicy(next);
  return next;
}

/**
 * A deliberately small classifier. It exists so the CLI can answer without an
 * agent present, and it says plainly that it is guessing — the skill, which has
 * the conversation and the code, is expected to do better.
 */
export function guessBucket(description: string): Bucket {
  const text = description.toLowerCase();
  const hard =
    /\b(architect|design|migrat|security|secure|auth|login|session|crypto|signature|signing|token|secret|credential|permission|payment|billing|checkout|stripe|webhook|invoice|concurren|race condition|deadlock|schema|rollout|rollback|encrypt|sanitiz|inject)\w*/;
  const cheap =
    /\b(test|tests|spec|doc|docs|docstring|comment|readme|changelog|rename|typo|format|lint|boilerplate|scaffold)\w*/;
  if (hard.test(text)) return "hard";
  if (cheap.test(text)) return "cheap";
  return "normal";
}

export interface RouteAnswer {
  bucket: Bucket;
  model: ModelEntry;
  /** Set when the policy model cannot run on any detected agent. */
  unavailable?: { reason: string; fallback?: ModelEntry };
  guessed: boolean;
}

export function resolveRoute(
  policy: RoutingPolicy,
  bucket: Bucket,
  installed: AgentId[],
  guessed: boolean,
): RouteAnswer {
  const model = findModel(policy.rules[bucket])!;
  const answer: RouteAnswer = { bucket, model, guessed };
  if (!installed.length) return answer;

  const runnable = model.nativeAgents.some((id) => installed.includes(id));
  if (runnable) return answer;

  // Prefer a model of the same tier the user can actually run; otherwise the
  // closest one by price, so the advice stays actionable.
  const reachable = MODEL_CATALOG.filter((candidate) =>
    candidate.nativeAgents.some((id) => installed.includes(id)),
  );
  const fallback =
    reachable.find((candidate) => candidate.tier === model.tier) ??
    reachable.sort(
      (a, b) =>
        Math.abs(a.inputCostPer1M - model.inputCostPer1M) -
        Math.abs(b.inputCostPer1M - model.inputCostPer1M),
    )[0];

  answer.unavailable = {
    reason: `${model.name} needs ${model.nativeAgents.join(" or ")}, which is not installed`,
    ...(fallback ? { fallback } : {}),
  };
  return answer;
}

function price(model: ModelEntry): string {
  return `$${model.inputCostPer1M}/$${model.outputCostPer1M} per M`;
}

export function formatPolicy(
  policy: RoutingPolicy,
  source: "file" | "default",
): string {
  const lines = [
    source === "file"
      ? `Your routing policy — ${policyPath()}`
      : "Default routing policy (not saved yet)",
    "",
  ];
  for (const bucket of BUCKETS) {
    const model = findModel(policy.rules[bucket])!;
    lines.push(
      `  ${bucket.padEnd(7)} ${model.name.padEnd(16)} ${price(model)}`,
    );
    lines.push(`  ${"".padEnd(7)} ${BUCKET_MEANING[bucket]}`);
  }
  lines.push(
    "",
    "Change it:  loadout route --set normal=gpt-5.6-terra",
    source === "default"
      ? "Save it:    loadout route --save"
      : "Reset it:   loadout route --reset",
  );
  return lines.join("\n");
}

export function formatAnswer(answer: RouteAnswer, task?: string): string {
  const lines: string[] = [];
  if (task) lines.push(`Task:   ${task}`, "");
  lines.push(
    `Bucket: ${answer.bucket} — ${BUCKET_MEANING[answer.bucket]}`,
    `Use:    ${answer.model.name}  (${price(answer.model)})`,
  );
  if (answer.unavailable) {
    lines.push("", `Note:   ${answer.unavailable.reason}.`);
    if (answer.unavailable.fallback)
      lines.push(
        `        Reachable alternative: ${answer.unavailable.fallback.name} (${price(answer.unavailable.fallback)}).`,
      );
  }
  if (answer.guessed)
    lines.push(
      "",
      "This bucket was guessed from wording alone. If the work is riskier than it",
      "reads — payments, auth, migrations — treat it as hard and move up.",
    );
  return lines.join("\n");
}
