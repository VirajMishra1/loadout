import type { HealthReport } from "../shared/types.js";
import { buildHealthReport } from "./health.js";

export interface ImprovementProposal {
  priority: number;
  problem: string;
  evidence: string[];
  outcome: string;
  acceptanceTests: string[];
  requiresHumanReview: boolean;
}

export interface ImprovementCycle {
  generatedAt: string;
  rule: "evidence-first-human-reviewed";
  selected?: ImprovementProposal;
  candidates: ImprovementProposal[];
  guardrails: string[];
}

export function proposeImprovements(report: HealthReport): ImprovementProposal[] {
  const proposals: ImprovementProposal[] = [];
  if (report.driftedFiles) proposals.push({ priority: 100, problem: "Managed files have drifted from recorded hashes.", evidence: [`${report.driftedFiles} drifted file(s) in the health report.`], outcome: "Every drifted file is attributed to a package and can be safely reconciled or adopted.", acceptanceTests: ["Health reports exact owning packages without exposing content.", "Sync dry-run explains restore, adopt, and ignore choices.", "No unrelated file is changed."], requiresHumanReview: true });
  if (report.updatesAvailable) proposals.push({ priority: 80, problem: "Installed packages have pending updates.", evidence: [`${report.updatesAvailable} update(s) in the health report.`], outcome: "Produce reviewable update plans and safely apply approved updates.", acceptanceTests: ["Every update shows commit and changed components.", "New scripts, hooks, domains, or environment names require approval.", "Failed verification restores the prior snapshot."], requiresHumanReview: true });
  if (!report.installedPackages) proposals.push({ priority: 50, problem: "The setup has no Loadout-managed packages.", evidence: ["Health report contains zero installed packages."], outcome: "Offer an explained tested profile or project-aware recommendations.", acceptanceTests: ["Recommendations include plain-language reasons.", "No package installs without confirmation."], requiresHumanReview: false });
  const missingAgents = report.agents.filter((agent) => !agent.installed);
  if (missingAgents.length) proposals.push({ priority: 20, problem: "Some supported agents are not available.", evidence: [missingAgents.map((agent) => agent.displayName).join(", ")], outcome: "Keep unsupported targets disabled and explain how to enable them.", acceptanceTests: ["Plans never target an undetected agent by default.", "Health output names missing agents without treating optional agents as corruption."], requiresHumanReview: false });
  return proposals.sort((a, b) => b.priority - a.priority);
}

export async function buildImprovementCycle(health: () => Promise<HealthReport> = buildHealthReport): Promise<ImprovementCycle> {
  const candidates = proposeImprovements(await health());
  return { generatedAt: new Date().toISOString(), rule: "evidence-first-human-reviewed", selected: candidates[0], candidates, guardrails: ["Never execute untrusted package code.", "Never expose secrets.", "Never weaken safety to make a test pass.", "Never apply or publish without the required human approval.", "Always prepare and verify rollback before mutation."] };
}

export function formatImprovementCycle(cycle: ImprovementCycle): string {
  if (!cycle.selected) return "No evidence-backed improvement is currently required.";
  const item = cycle.selected;
  return [`Next improvement: ${item.problem}`, `Evidence: ${item.evidence.join(" ")}`, `Desired outcome: ${item.outcome}`, "Acceptance tests:", ...item.acceptanceTests.map((test) => `  - ${test}`), `Human review: ${item.requiresHumanReview ? "required" : "required before release"}`].join("\n");
}
