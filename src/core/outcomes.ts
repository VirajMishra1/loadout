import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentId, ProjectSignals } from "../shared/types.js";
import { writeFileAtomically } from "./atomic-file.js";
import { ensureDirectory, loadoutHome } from "./paths.js";

export type OutcomeResult =
  | "accept"
  | "reject"
  | "success"
  | "failure"
  | "activation"
  | "disable"
  | "rollback";

export type OutcomeTaskFamily =
  | "general"
  | "frontend"
  | "testing"
  | "javascript"
  | "python"
  | "backend"
  | "security"
  | "documentation";

export interface LocalOutcomeEvent {
  id: string;
  recordedAt: string;
  selector: string;
  agent: AgentId;
  taskFamily: OutcomeTaskFamily;
  result: OutcomeResult;
}

export interface LocalOutcomeStore {
  schemaVersion: 1;
  events: LocalOutcomeEvent[];
  privacy: "local-only-no-project-or-content";
}

const outcomePath = (): string => join(loadoutHome(), "outcomes.json");
const RESULTS = new Set<OutcomeResult>([
  "accept",
  "reject",
  "success",
  "failure",
  "activation",
  "disable",
  "rollback",
]);
const TASKS = new Set<OutcomeTaskFamily>([
  "general",
  "frontend",
  "testing",
  "javascript",
  "python",
  "backend",
  "security",
  "documentation",
]);
const AGENTS = new Set<AgentId>([
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "opencode",
  "hermes",
  "windsurf",
  "cline",
  "github-copilot",
  "roo-code",
  "kiro-cli",
  "junie",
]);

function validEvent(value: unknown): value is LocalOutcomeEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as LocalOutcomeEvent;
  return (
    typeof event.id === "string" &&
    typeof event.recordedAt === "string" &&
    typeof event.selector === "string" &&
    AGENTS.has(event.agent) &&
    TASKS.has(event.taskFamily) &&
    RESULTS.has(event.result)
  );
}

export async function readLocalOutcomes(): Promise<LocalOutcomeStore> {
  try {
    const value: unknown = JSON.parse(await readFile(outcomePath(), "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (value as LocalOutcomeStore).schemaVersion !== 1 ||
      !Array.isArray((value as LocalOutcomeStore).events) ||
      !(value as LocalOutcomeStore).events.every(validEvent)
    )
      throw new Error("outcome schema is invalid");
    return value as LocalOutcomeStore;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return {
        schemaVersion: 1,
        events: [],
        privacy: "local-only-no-project-or-content",
      };
    throw new Error(
      `Loadout outcomes are invalid at ${outcomePath()}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validateSelector(selector: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(selector))
    throw new Error("Outcome selector must be package/skill, not a path");
}

export async function recordLocalOutcome(
  event: Omit<LocalOutcomeEvent, "id" | "recordedAt">,
  now = new Date(),
): Promise<LocalOutcomeEvent> {
  validateSelector(event.selector);
  if (!TASKS.has(event.taskFamily))
    throw new Error(`Unknown task family: ${event.taskFamily}`);
  if (!RESULTS.has(event.result))
    throw new Error(`Unknown outcome result: ${event.result}`);
  const store = await readLocalOutcomes();
  const recorded: LocalOutcomeEvent = {
    ...event,
    id: `${now.getTime()}-${store.events.length + 1}`,
    recordedAt: now.toISOString(),
  };
  store.events = [...store.events.slice(-999), recorded];
  await ensureDirectory(dirname(outcomePath()));
  await writeFileAtomically(
    outcomePath(),
    `${JSON.stringify(store, null, 2)}\n`,
  );
  return recorded;
}

export function projectTaskFamilies(
  project: ProjectSignals,
): OutcomeTaskFamily[] {
  const families = new Set<OutcomeTaskFamily>(["general"]);
  if (project.languages.includes("javascript/typescript"))
    families.add("javascript");
  if (project.languages.includes("python")) families.add("python");
  if (
    project.languages.some((item) =>
      ["go", "rust", "java", ".net"].includes(item),
    )
  )
    families.add("backend");
  if (project.frameworks.length) families.add("frontend");
  if (project.frameworks.includes("playwright")) families.add("testing");
  return [...families];
}

export function outcomeAdjustment(
  store: LocalOutcomeStore,
  selector: string,
  agent: AgentId,
  taskFamilies: OutcomeTaskFamily[],
): { score: number; evidence: string[] } {
  const relevant = store.events.filter(
    (event) =>
      event.selector === selector &&
      event.agent === agent &&
      (event.taskFamily === "general" ||
        taskFamilies.includes(event.taskFamily)),
  );
  const weights: Record<OutcomeResult, number> = {
    accept: 18,
    reject: -30,
    success: 15,
    failure: -25,
    activation: 2,
    disable: -8,
    rollback: -35,
  };
  const raw = relevant.reduce(
    (total, event) => total + weights[event.result],
    0,
  );
  const score = Math.max(-60, Math.min(60, raw));
  return {
    score,
    evidence: relevant.length
      ? [
          `${relevant.length} local outcome(s) in the same agent/task scope: ${score >= 0 ? "+" : ""}${score}`,
        ]
      : [],
  };
}
