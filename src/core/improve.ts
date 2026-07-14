import type { HealthReport } from "../shared/types.js";
import { buildHealthReport } from "./health.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadoutHome } from "./paths.js";
import { detectSecretKinds } from "./safety.js";

export interface ImprovementProposal {
  priority: number;
  problem: string;
  evidence: string[];
  outcome: string;
  acceptanceTests: string[];
  requiresHumanReview: boolean;
}

export interface ImprovementCycle {
  id: string;
  generatedAt: string;
  rule: "evidence-first-human-reviewed";
  selected?: ImprovementProposal;
  candidates: ImprovementProposal[];
  guardrails: string[];
  priorOutcomes: Array<{ id: string; outcome: "success" | "failure" | "partial"; note?: string }>;
  feedback?: Array<{ outcome: "success" | "failure" | "partial"; note?: string; recordedAt: string }>;
}

export function proposeImprovements(report: HealthReport): ImprovementProposal[] {
  const proposals: ImprovementProposal[] = [];
  if (report.driftedFiles) proposals.push({ priority: 100, problem: "Managed files have drifted from recorded hashes.", evidence: [`${report.driftedFiles} drifted file(s) in the health report.`], outcome: "Every drifted file is attributed to a package and can be safely reconciled or adopted.", acceptanceTests: ["Health reports exact owning packages without exposing content.", "Sync dry-run explains restore, adopt, and ignore choices.", "No unrelated file is changed."], requiresHumanReview: true });
  if (report.driftedMcpServers) proposals.push({ priority: 100, problem: "Managed MCP configuration has drifted.", evidence: [`${report.driftedMcpServers} drifted MCP server entry or entries in the health report.`], outcome: "Every MCP change is attributed and can be reviewed, restored, adopted, or removed without changing unrelated servers.", acceptanceTests: ["Health identifies the owning package and config path without exposing secret values.", "Sync dry-run preserves unrelated keys and servers.", "Recovery restores exact previous configuration and state."], requiresHumanReview: true });
  if (report.updatesAvailable) proposals.push({ priority: 80, problem: "Installed packages have pending updates.", evidence: [`${report.updatesAvailable} update(s) in the health report.`], outcome: "Produce reviewable update plans and safely apply approved updates.", acceptanceTests: ["Every update shows commit and changed components.", "New scripts, hooks, domains, or environment names require approval.", "Failed verification restores the prior snapshot."], requiresHumanReview: true });
  if (!report.installedPackages) proposals.push({ priority: 50, problem: "The setup has no Loadout-managed packages.", evidence: ["Health report contains zero installed packages."], outcome: "Offer an explained tested profile or project-aware recommendations.", acceptanceTests: ["Recommendations include plain-language reasons.", "No package installs without confirmation."], requiresHumanReview: false });
  const missingAgents = report.agents.filter((agent) => !agent.installed);
  if (missingAgents.length) proposals.push({ priority: 20, problem: "Some supported agents are not available.", evidence: [missingAgents.map((agent) => agent.displayName).join(", ")], outcome: "Keep unsupported targets disabled and explain how to enable them.", acceptanceTests: ["Plans never target an undetected agent by default.", "Health output names missing agents without treating optional agents as corruption."], requiresHumanReview: false });
  return proposals.sort((a, b) => b.priority - a.priority);
}

export async function buildImprovementCycle(health: () => Promise<HealthReport> = buildHealthReport): Promise<ImprovementCycle> {
  const candidates = proposeImprovements(await health());
  const generatedAt = new Date().toISOString();
  const priorOutcomes = await readPriorOutcomes();
  const id = `${generatedAt.replace(/[:.]/g, "-")}-${createHash("sha256").update(JSON.stringify(candidates[0] ?? generatedAt)).digest("hex").slice(0, 8)}`;
  return { id, generatedAt, rule: "evidence-first-human-reviewed", selected: candidates[0], candidates, guardrails: ["Never execute untrusted package code.", "Never expose secrets.", "Never weaken safety to make a test pass.", "Never apply or publish without the required human approval.", "Always prepare and verify rollback before mutation."], priorOutcomes };
}

export function formatImprovementCycle(cycle: ImprovementCycle): string {
  if (!cycle.selected) return "No evidence-backed improvement is currently required.";
  const item = cycle.selected;
  return [`Next improvement: ${item.problem}`, `Evidence: ${item.evidence.join(" ")}`, `Desired outcome: ${item.outcome}`, "Acceptance tests:", ...item.acceptanceTests.map((test) => `  - ${test}`), `Human review: ${item.requiresHumanReview ? "required" : "required before release"}`].join("\n");
}

const improvementHome = () => join(loadoutHome(), "improvements");

async function readPriorOutcomes(): Promise<ImprovementCycle["priorOutcomes"]> {
  let names: string[] = []; try { names = (await readdir(improvementHome())).filter((name) => name.endsWith(".json")).sort().slice(-20); } catch { return []; }
  const outcomes: ImprovementCycle["priorOutcomes"] = [];
  for (const name of names) {
    try {
      const cycle = JSON.parse(await readFile(join(improvementHome(), name), "utf8")) as ImprovementCycle;
      const latest = cycle.feedback?.at(-1);
      if (latest) outcomes.push({ id: cycle.id, outcome: latest.outcome, ...(latest.note ? { note: latest.note } : {}) });
    } catch { /* corrupt historical entries are ignored by proposal generation */ }
  }
  return outcomes;
}

export function improvementPrompt(cycle: ImprovementCycle): string {
  const selected = cycle.selected;
  return [`# Loadout improvement cycle ${cycle.id}`, "", "You are improving Loadout using evidence, not guesses. Work only on the authorized developer branch.", "", "## Selected problem", "", selected?.problem ?? "No evidence-backed problem is currently selected.", "", "## Evidence", "", ...(selected?.evidence.map((item) => `- ${item}`) ?? ["- None"]), "", "## Required outcome", "", selected?.outcome ?? "Keep the current system stable.", "", "## Acceptance tests", "", ...(selected?.acceptanceTests.map((item) => `- ${item}`) ?? ["- No change required"]), "", "## Loop rules", "", "1. Inspect current behavior before editing.", "2. Implement the smallest complete solution without weakening safety or scope.", "3. Add regression tests and plain-language documentation.", "4. Run relevant unit, integration, security, build, and demo checks.", "5. Stop for human review when trust, permissions, compatibility claims, publishing, or release behavior changes.", "6. Never expose secrets, execute untrusted package code, rewrite Git history, force-push, merge, or publish automatically.", "7. Record exact evidence, remaining risks, and the next priority.", "", "## Guardrails", "", ...cycle.guardrails.map((item) => `- ${item}`), ""].join("\n");
}

export async function writeImprovementCycle(cycle: ImprovementCycle, directory = improvementHome()): Promise<{ json: string; prompt: string }> {
  const root = resolve(directory); await mkdir(root, { recursive: true });
  const json = join(root, `${cycle.id}.json`); const prompt = join(root, `${cycle.id}.md`);
  await writeFile(json, `${JSON.stringify(cycle, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(prompt, improvementPrompt(cycle), { mode: 0o600, flag: "wx" });
  return { json, prompt };
}

export async function recordImprovementOutcome(id: string, outcome: "success" | "failure" | "partial", note?: string, directory = improvementHome()): Promise<ImprovementCycle> {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("Invalid improvement cycle id");
  if (note && note.length > 1_000) throw new Error("Improvement outcome note is too long");
  if (note && detectSecretKinds(note).length) throw new Error("Improvement outcome note appears to contain secret material");
  const path = join(resolve(directory), `${id}.json`);
  const cycle = JSON.parse(await readFile(path, "utf8")) as ImprovementCycle;
  if (cycle.id !== id) throw new Error("Improvement cycle id does not match its file");
  cycle.feedback = [...(cycle.feedback ?? []), { outcome, ...(note ? { note } : {}), recordedAt: new Date().toISOString() }];
  await writeFile(path, `${JSON.stringify(cycle, null, 2)}\n`, { mode: 0o600 });
  return cycle;
}
