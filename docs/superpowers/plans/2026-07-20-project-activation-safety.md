# Project Activation Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project activation respect every agent's real active-skill capacity, tolerate recursively empty rollback residue, and recommend a compact project-relevant set.

**Architecture:** Extract the existing bounded target-occupancy rule into one shared filesystem module used by setup and activation. Build per-agent budgets from the read-only installed-skill inventory, then score and slice reviewed library candidates per agent. Extend deterministic local project signals and recommendation metadata without introducing network or model calls.

**Tech Stack:** TypeScript 5.7, Node.js 20+, Commander 12, Vitest 4, existing Loadout transaction/state/inventory modules.

## Global Constraints

- No model or external API call is required for recommendation or activation.
- No project source, filename, dependency, or outcome data leaves the machine.
- Never execute package code while scanning, recommending, or activating.
- Missing and recursively empty targets are unoccupied; files, symlinks, special entries, unreadable directories, and scans beyond 10,000 entries are occupied.
- `--limit` is a per-agent ceiling over managed plus unmanaged skills containing `SKILL.md`.
- Preview remains read-only; apply revalidates inside one rollback-safe transaction.
- Existing CLI flags remain valid; the project-plan JSON schema may add per-agent budgets in 0.4.1.

---

### Task 1: Share the bounded target-occupancy rule

**Files:**

- Create: `src/core/target-occupancy.ts`
- Create: `tests/target-occupancy.test.ts`
- Modify: `src/core/install.ts`
- Modify: `src/core/active-set.ts`
- Modify: `tests/active-set.test.ts`

**Interfaces:**

- Produces: `inspectTargetOccupancy(path: string, maximumEntries?: number): Promise<TargetOccupancy>`.
- Consumed by: setup collision checks and activation preview/apply checks.

- [ ] **Step 1: Write failing occupancy tests**

```ts
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { inspectTargetOccupancy } from "../src/core/target-occupancy.js";

it("treats missing and recursively empty targets as unoccupied", async () => {
  const root = await mkdtemp(join(tmpdir(), "loadout-target-"));
  const empty = join(root, "skill");
  await mkdir(join(empty, "nested"), { recursive: true });
  await expect(
    inspectTargetOccupancy(join(root, "missing")),
  ).resolves.toMatchObject({ occupied: false });
  await expect(inspectTargetOccupancy(empty)).resolves.toMatchObject({
    occupied: false,
  });
});

it("treats content, symlinks, and the inspection bound as occupied", async () => {
  const root = await mkdtemp(join(tmpdir(), "loadout-target-"));
  const content = join(root, "content");
  const linked = join(root, "linked");
  await mkdir(content);
  await writeFile(join(content, "SKILL.md"), "content");
  await symlink(content, linked);
  await expect(inspectTargetOccupancy(content)).resolves.toMatchObject({
    occupied: true,
    reason: "content",
  });
  await expect(inspectTargetOccupancy(linked)).resolves.toMatchObject({
    occupied: true,
    reason: "symlink",
  });
  await expect(inspectTargetOccupancy(join(root), 1)).resolves.toMatchObject({
    occupied: true,
    reason: "inspection-limit",
  });
});
```

- [ ] **Step 2: Run the occupancy tests and verify RED**

Run: `npx vitest run tests/target-occupancy.test.ts`  
Expected: FAIL because `src/core/target-occupancy.ts` does not exist.

- [ ] **Step 3: Implement the shared predicate**

```ts
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface TargetOccupancy {
  occupied: boolean;
  reason?:
    "content" | "symlink" | "unsupported" | "unreadable" | "inspection-limit";
}

export async function inspectTargetOccupancy(
  path: string,
  maximumEntries = 10_000,
): Promise<TargetOccupancy> {
  let root;
  try {
    root = await lstat(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return { occupied: false };
    return { occupied: true, reason: "unreadable" };
  }
  if (root.isSymbolicLink()) return { occupied: true, reason: "symlink" };
  if (!root.isDirectory()) return { occupied: true, reason: "unsupported" };
  const queue = [path];
  let inspected = 0;
  while (queue.length) {
    const directory = queue.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return { occupied: true, reason: "unreadable" };
    }
    for (const entry of entries) {
      inspected += 1;
      if (inspected > maximumEntries)
        return { occupied: true, reason: "inspection-limit" };
      if (entry.isDirectory() && !entry.isSymbolicLink())
        queue.push(join(directory, entry.name));
      else
        return {
          occupied: true,
          reason: entry.isSymbolicLink() ? "symlink" : "content",
        };
    }
  }
  return { occupied: false };
}
```

- [ ] **Step 4: Replace duplicate setup logic and activation `pathExists` checks**

In `src/core/install.ts`, import `inspectTargetOccupancy` and replace the recursive block in `assertActiveTargetsUnoccupied` with:

```ts
for (const target of targets) {
  if ((await inspectTargetOccupancy(target)).occupied) occupied.push(target);
}
```

In `src/core/active-set.ts`, use the same predicate when enabling and include the reason in the blocker. Re-run the check immediately before the transaction copies any target; remove only targets proven recursively empty.

- [ ] **Step 5: Add the activation regression**

Extend `tests/active-set.test.ts` so a disabled library entry with `empty/nested` under its active target previews without blockers and applies, while a target containing `notes.txt` remains blocked and unchanged.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npx vitest run tests/target-occupancy.test.ts tests/install.test.ts tests/active-set.test.ts`  
Expected: all tests pass.

```bash
git add src/core/target-occupancy.ts src/core/install.ts src/core/active-set.ts tests/target-occupancy.test.ts tests/active-set.test.ts
git commit -m "fix: share safe target occupancy checks"
```

### Task 2: Enforce per-agent total active capacity

**Files:**

- Modify: `src/core/active-policy.ts`
- Modify: `src/core/active-set.ts`
- Modify: `tests/active-policy.test.ts`

**Interfaces:**

- Consumes: `detectAgents()`, `scanInstalledSkills()`, and reviewed activation records.
- Produces: `AgentActiveSetPlan` records with total, managed, unmanaged, capacity, and selected candidates.

- [ ] **Step 1: Write failing mixed-agent capacity tests**

Add a fixture with 12 unmanaged `SKILL.md` directories under Claude's skill root, zero under Codex, and 40 reviewed disabled candidates per agent. Assert:

```ts
const plan = await planProjectActivation(project, {
  agents: ["claude-code", "codex"],
  limit: 30,
});
expect(
  plan.agentPlans.find((item) => item.agent === "claude-code"),
).toMatchObject({
  activeBefore: 12,
  unmanagedBefore: 12,
  capacity: 18,
});
expect(
  plan.agentPlans.find((item) => item.agent === "claude-code")!.selected,
).toHaveLength(18);
expect(plan.agentPlans.find((item) => item.agent === "codex")).toMatchObject({
  activeBefore: 0,
  capacity: 30,
});
expect(
  plan.agentPlans.find((item) => item.agent === "codex")!.selected,
).toHaveLength(30);
```

Add a second test where Claude already has 30 unmanaged skills and Codex has none. Claude must receive zero additions and Codex must still receive candidates.

- [ ] **Step 2: Run the capacity tests and verify RED**

Run: `npx vitest run tests/active-policy.test.ts`  
Expected: FAIL because the plan has one managed-only global budget and no `agentPlans`.

- [ ] **Step 3: Add per-agent plan types and inventory-backed budgets**

```ts
export interface AgentActiveSetPlan {
  agent: AgentId;
  activeBefore: number;
  managedBefore: number;
  unmanagedBefore: number;
  capacity: number;
  selected: ActiveSetCandidate[];
}

export interface ProjectActiveSetPlan {
  project: ProjectSignals;
  limit: number;
  agents?: AgentId[];
  agentPlans: AgentActiveSetPlan[];
  activation?: ActivationPlan;
  warnings: string[];
}
```

Resolve requested agents through `detectAgents`, call `scanInstalledSkills`, and create one budget from each inventory summary. Score only that agent's reviewed disabled records, diversify them, and slice to that agent's capacity.

- [ ] **Step 4: Merge exact per-agent activation plans**

Call `planActivationChange("enable", selectors, { agents: [agent] })` once per non-empty agent selection and combine `changes`, `skipped`, `warnings`, `blocked`, and unique package IDs into one transaction plan. `applyProjectActivation` continues to call `applyActivationChange` exactly once.

Before copying, re-scan inventory and abort if any agent's current total would make the planned additions exceed `limit`.

- [ ] **Step 5: Format truthful per-agent budgets**

Replace the global budget line with:

```text
Claude Code: 12 active (0 managed, 12 unmanaged); 18/30 slots available
Codex: 0 active (0 managed, 0 unmanaged); 30/30 slots available
```

Group additions beneath their target agent and do not duplicate one global list that implies identical capacities.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npx vitest run tests/active-policy.test.ts tests/active-set.test.ts tests/skill-inventory.test.ts`  
Expected: all tests pass, including 18 Claude additions and 30 Codex additions.

```bash
git add src/core/active-policy.ts src/core/active-set.ts tests/active-policy.test.ts
git commit -m "fix: enforce per-agent active skill limits"
```

### Task 3: Detect bounded Node CLI and package signals

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/recommend.ts`
- Modify: `tests/recommend.test.ts`

**Interfaces:**

- Extends `ProjectSignals` with `roles: string[]` and `tools: string[]`.
- Consumed by package recommendations and skill ranking.

- [ ] **Step 1: Write failing signal tests**

Create a package fixture containing `bin`, `publishConfig`, `commander`, `zod`, `vitest`, `@playwright/test`, `prepack`, and an `mcp` keyword, plus `SECURITY.md`. Assert:

```ts
expect(signals.roles).toEqual(
  expect.arrayContaining([
    "node-cli",
    "npm-package",
    "release",
    "mcp",
    "security",
  ]),
);
expect(signals.tools).toEqual(
  expect.arrayContaining(["commander", "zod", "vitest", "playwright"]),
);
```

- [ ] **Step 2: Run the recommendation tests and verify RED**

Run: `npx vitest run tests/recommend.test.ts`  
Expected: FAIL because `roles` and `tools` are absent.

- [ ] **Step 3: Extend project signals and parse only known metadata**

```ts
export interface ProjectSignals {
  root: string;
  languages: string[];
  frameworks: string[];
  roles: string[];
  tools: string[];
  files: string[];
}
```

In `scanProject`, derive roles and tools only from root entry names, known manifest fields, dependencies/devDependencies, scripts, publish metadata, and keywords. Do not recursively read arbitrary source content.

- [ ] **Step 4: Format readable detected roles**

Add display labels so human output says `TypeScript, Node CLI, npm package, Vitest, Playwright, MCP tooling` while JSON retains stable lowercase identifiers.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx vitest run tests/recommend.test.ts tests/outcomes.test.ts`  
Expected: all tests pass.

```bash
git add src/shared/types.ts src/core/recommend.ts tests/recommend.test.ts
git commit -m "feat: detect local cli and package signals"
```

### Task 4: Diversify project skill selection

**Files:**

- Modify: `src/core/active-policy.ts`
- Modify: `tests/active-policy.test.ts`

**Interfaces:**

- Consumes: extended `ProjectSignals`.
- Produces: evidence-threshold candidates grouped by capability family.

- [ ] **Step 1: Write failing relevance tests**

Add reviewed candidates named `javascript-typescript-jest`, `vitest-testing`, five Playwright variants, `cli-design`, `npm-package`, and `mcp-security`. For a Vitest Node CLI fixture, assert Jest is absent, CLI/npm/MCP candidates are present, and no more than three browser-testing candidates are selected.

- [ ] **Step 2: Run the active-policy tests and verify RED**

Run: `npx vitest run tests/active-policy.test.ts`  
Expected: FAIL because current ranking selects Jest and redundant Playwright variants.

- [ ] **Step 3: Add exact signal rules and mismatch rejection**

Add role/tool rules for Node CLI, npm package, Vitest, Commander, Zod, MCP, release, and security. Reject a candidate matching `jest` when `vitest` is present and `jest` is absent.

- [ ] **Step 4: Add deterministic family caps**

Implement `candidateFamily(unitId)` and deterministic caps: browser testing 3; documentation 2; code review 2; architecture 2; planning 3; security 3; language/tooling 5; uncategorized 3. Explicit full-selector pins bypass family caps but still consume capacity. Stop after eligible candidates are exhausted; never fill unused slots with candidates below the existing evidence threshold.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx vitest run tests/active-policy.test.ts`  
Expected: all relevance, diversity, pin, outcome, and per-agent capacity tests pass.

```bash
git add src/core/active-policy.ts tests/active-policy.test.ts
git commit -m "feat: diversify project skill selection"
```

### Task 5: Label recommendation component types

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/recommend.ts`
- Modify: `tests/recommend.test.ts`

**Interfaces:**

- Extends `PackageRecommendation` with `kind: "skill-library" | "mcp-runtime" | "unavailable"`.
- Uses catalog `components` to classify suggestions.

- [ ] **Step 1: Write failing type-label tests**

Assert Superpowers formats as `skill library`, while Playwright MCP and GitHub MCP format as `MCP/runtime setup` and include a separate preview/setup hint rather than activation wording.

- [ ] **Step 2: Run the recommendation tests and verify RED**

Run: `npx vitest run tests/recommend.test.ts`  
Expected: FAIL because recommendations have no `kind`.

- [ ] **Step 3: Classify catalog-backed recommendations**

```ts
function recommendationKind(
  pkg: CatalogPackage,
): PackageRecommendation["kind"] {
  if (pkg.components?.includes("skill")) return "skill-library";
  if (pkg.components?.some((item) => item === "mcp" || item === "plugin"))
    return "mcp-runtime";
  return "unavailable";
}
```

Attach the kind when adding each catalog recommendation and preserve it through local-outcome personalization.

- [ ] **Step 4: Format kinds and next actions**

Human output must label every line and end MCP/runtime suggestions with the read-only recipe or explicit setup command supported by the package. It must not claim those integrations are automatically activatable skills.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx vitest run tests/recommend.test.ts tests/outcomes.test.ts`  
Expected: all tests pass.

```bash
git add src/shared/types.ts src/core/recommend.ts tests/recommend.test.ts
git commit -m "feat: label recommendation component types"
```

### Task 6: Verify the product path and prepare the release candidate

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `master_plan.md`
- Modify: `docs/USER_TEST_GUIDE.md`
- Modify: `scripts/cli-product-flow.mjs`

**Interfaces:**

- Consumes: all corrected preview/apply behavior.
- Produces: repeatable release and founder acceptance evidence.

- [ ] **Step 1: Extend the CLI product-flow regression**

Add a journey that creates one agent with unmanaged skills and one empty agent, restores recursively empty snapshot residue, installs a disabled library, previews project activation, applies it, and rolls back the explicit activation snapshot. Assert unmanaged bytes are unchanged at every point.

- [ ] **Step 2: Run the focused product flow and verify RED before updating its expectations**

Run: `npm run test:e2e:cli`  
Expected before the journey implementation is complete: FAIL on the new capacity or empty-target assertion.

- [ ] **Step 3: Update user-facing documentation**

Document that `--limit` includes unmanaged skills, Maximum remains disabled by default, recommendations distinguish skills from MCP/runtime setup, and project activation may choose different set sizes per agent.

- [ ] **Step 4: Run the full local release gate**

Run: `npm run verify`  
Expected: formatting, lint, typecheck, evidence checks, unit tests, CLI/readme/package flows, and performance checks all pass.

- [ ] **Step 5: Build and inspect the packed npm artifact without publishing**

Run: `npm pack --dry-run`  
Expected: the package contains the corrected compiled CLI and no untracked secret or local-state files.

- [ ] **Step 6: Record completion and commit**

Mark only the implemented portions of `P18-27` complete, record exact test counts and remaining founder/npm steps, and keep real-profile activation blocked until the corrected package is published.

```bash
git add CHANGELOG.md MASTER_PLAN.md docs/USER_TEST_GUIDE.md scripts/cli-product-flow.mjs
git commit -m "test: cover safe project activation journey"
```
