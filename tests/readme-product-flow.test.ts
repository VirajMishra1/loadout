import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");

function webpDimensions(image: Buffer): { width: number; height: number } {
  if (
    image.toString("ascii", 0, 4) !== "RIFF" ||
    image.toString("ascii", 8, 12) !== "WEBP" ||
    image.toString("ascii", 12, 16) !== "VP8 " ||
    image.readUIntLE(23, 3) !== 0x2a019d
  ) {
    throw new Error("Expected a lossy VP8 WebP image");
  }
  return {
    width: image.readUInt16LE(26) & 0x3fff,
    height: image.readUInt16LE(28) & 0x3fff,
  };
}

function expectOrderedReadmeStructure(
  readme: string,
  sections: readonly string[],
  markerNames: readonly string[],
): void {
  const markdownHeadings: string[] = [];
  let fence: "`" | "~" | undefined;
  for (const line of readme.split(/\r?\n/)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const delimiter = fenceMatch[1][0] as "`" | "~";
      if (fence === undefined) fence = delimiter;
      else if (fence === delimiter) fence = undefined;
      continue;
    }
    if (fence === undefined && /^#{1,6} /.test(line)) {
      markdownHeadings.push(line);
    }
  }

  let previousSection = -1;
  for (const section of sections) {
    const matches = markdownHeadings.flatMap((heading, index) =>
      heading === section ? [index] : [],
    );
    if (matches.length !== 1 || matches[0] <= previousSection) {
      throw new Error(
        "README sections must appear exactly once in approved order",
      );
    }
    previousSection = matches[0];
  }

  let previousEnd = -1;
  for (const name of markerNames) {
    const startMarker = `<!-- loadout:${name}:start -->`;
    const endMarker = `<!-- loadout:${name}:end -->`;
    const start = readme.indexOf(startMarker);
    const end = readme.indexOf(endMarker);
    if (
      start === -1 ||
      end === -1 ||
      start !== readme.lastIndexOf(startMarker) ||
      end !== readme.lastIndexOf(endMarker) ||
      start >= end ||
      start <= previousEnd
    ) {
      throw new Error(
        "README marker pairs must be unique, ordered and non-overlapping",
      );
    }
    previousEnd = end;
  }
}

describe("README product flow", () => {
  it("rejects overlapping generated marker blocks", () => {
    expect(() =>
      expectOrderedReadmeStructure(
        [
          "## How it works",
          "<!-- loadout:catalog-coverage:start -->",
          "<!-- loadout:evidence-stages:start -->",
          "<!-- loadout:catalog-coverage:end -->",
          "<!-- loadout:evidence-stages:end -->",
        ].join("\n"),
        ["## How it works"],
        ["catalog-coverage", "evidence-stages"],
      ),
    ).toThrow(/ordered and non-overlapping/i);
  });

  it.each([
    ["wrong level", "### How it works\n"],
    ["fenced code", "```markdown\n## How it works\n```\n"],
  ])("rejects an expected heading in %s", (_label, fixture) => {
    expect(() =>
      expectOrderedReadmeStructure(fixture, ["## How it works"], []),
    ).toThrow(/sections must appear exactly once/i);
  });

  it("presents the approved proof-first product journey", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");

    const productImages = readme.match(/<img\b[^>]*>/gi) ?? [];
    const discoverImage = productImages.filter((element) =>
      /\ssrc="\.\/docs\/assets\/loadout-discover-activate\.webp"/i.test(
        element,
      ),
    );
    const coordinationImage = productImages.filter((element) =>
      /\ssrc="\.\/docs\/assets\/loadout-handoff-coordinate\.webp"/i.test(
        element,
      ),
    );
    expect(discoverImage).toHaveLength(1);
    expect(coordinationImage).toHaveLength(1);
    expect(discoverImage[0]).toContain("discovers agent skills");
    expect(coordinationImage[0]).toContain(
      "durable task handoffs between sessions",
    );

    for (const name of [
      "loadout-discover-activate.webp",
      "loadout-handoff-coordinate.webp",
    ]) {
      const image = await readFile(
        resolve(repositoryRoot, "docs/assets", name),
      );
      const { width, height } = webpDimensions(image);
      expect(width / height).toBeGreaterThan(1.7);
      expect(width / height).toBeLessThan(1.9);
      expect(image.byteLength).toBeLessThan(300_000);
    }
    expect(readme).not.toMatch(/founder|revolutionary|game-changing/i);
    expect(readme).toContain("Agent extensions, under control.");
    expect(readme).toContain("Choose -> Inspect -> Preview -> Apply -> Undo");
    expect(readme).toMatch(/abridged terminal transcript/i);
    expect(readme).toContain("npm install --global loadout-ai");
    expect(readme.split(/\r?\n/).length).toBeLessThanOrEqual(425);
    expect(readme.indexOf("### Demo")).toBeLessThan(
      readme.indexOf("## Install"),
    );

    expectOrderedReadmeStructure(
      readme,
      [
        "## Install",
        "## How it works",
        "### Abridged terminal transcript",
        "## Why Loadout",
        "## Stable workflow",
        "## Profiles",
        "## Catalog and discovery",
        "## Trust and limits",
        "## Agent support",
        "## Command reference",
        "## Built with Claude and Codex",
        "## Development",
        "## Documentation",
        "## Contributing, security, and attribution",
        "## License",
      ],
      [
        "catalog-coverage",
        "evidence-stages",
        "daily-discovery",
        "current-limits",
        "support-summary",
        "verification-summary",
      ],
    );
    expect(readme).toContain(
      "designed and built by [Viraj Mishra](https://github.com/VirajMishra1) with Claude Code and Codex",
    );
  });

  it("ships a GitHub social preview with the required size and handoff message", async () => {
    const preview = await readFile(
      resolve(repositoryRoot, "docs/assets/loadout-social-preview.png"),
    );
    expect(preview.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(preview.readUInt32BE(16)).toBe(1280);
    expect(preview.readUInt32BE(20)).toBe(640);
    expect(preview.byteLength).toBeLessThan(1_000_000);
  });

  it("tells the Loadout story in the Why Loadout section", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");
    const start = readme.indexOf("## Why Loadout");
    const end = readme.indexOf("## Stable workflow", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const whyLoadout = readme.slice(start, end);
    const storyAnchors = [
      /why does improving an AI coding agent[^?]*GitHub tabs/i,
      /skills, plugins, MCP servers, and settings[^.]*experiment/i,
      /hard to remember[^.]*installed[^.]*came from[^.]*undo/i,
      /name comes from games[^.]*loadout[^.]*tools[^.]*mission/i,
      /AI\s+coding agents/i,
      /what is actually worth knowing/i,
      /disabled Maximum library/i,
      /focused active set/i,
    ];

    let previousIndex = -1;
    for (const anchor of storyAnchors) {
      const match = anchor.exec(whyLoadout);
      expect(match).not.toBeNull();
      const currentIndex = match?.index ?? -1;
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
  });

  it("installs both first-party skills before promising their agent workflows", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");
    const start = readme.indexOf("## Use it from inside your agent");
    const end = readme.indexOf("## Passing work between two agents", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const agentUsage = readme.slice(start, end);
    expect(agentUsage).toContain(
      "loadout skills install loadout-handoff --yes",
    );
    expect(agentUsage).toContain(
      "loadout skills install loadout-curator --yes",
    );
  });

  it("keeps visitor-facing repository identity aligned with canonical upstream", async () => {
    const [readme, packageJsonText, schemaText] = await Promise.all([
      readFile(resolve(repositoryRoot, "README.md"), "utf8"),
      readFile(resolve(repositoryRoot, "package.json"), "utf8"),
      readFile(
        resolve(repositoryRoot, "docs/evidence/live-checks.schema.json"),
        "utf8",
      ),
    ]);
    const packageJson = JSON.parse(packageJsonText);
    const schema = JSON.parse(schemaText);

    expect(readme).toContain(
      '<a href="https://github.com/VirajMishra1/loadout/actions/workflows/ci.yml"><img src="https://github.com/VirajMishra1/loadout/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>',
    );
    expect(readme).not.toContain("git clone ");
    expect(readme).toContain("https://github.com/VirajMishra1/loadout/issues");
    expect(readme).not.toContain("https://github.com/reddynitish/loadout");
    expect(packageJson.repository.url).toBe(
      "git+https://github.com/VirajMishra1/loadout.git",
    );
    expect(packageJson.homepage).toBe(
      "https://github.com/VirajMishra1/loadout#readme",
    );
    expect(packageJson.bugs.url).toBe(
      "https://github.com/VirajMishra1/loadout/issues",
    );
    expect(schema.$id).toBe(
      "https://github.com/VirajMishra1/loadout/docs/evidence/live-checks.schema.json",
    );
  });

  it("bounds Stable preview output and later apply identity", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");

    expect(readme).toContain(
      "Preview complete; nothing was changed. Re-run with --yes to install this exact screened plan.",
    );
    expect(readme.match(/exact screened plan/g)).toHaveLength(1);
    expect(readme).toContain(
      "A later `--yes` invocation recomputes the plan from pinned sources and current agent and filesystem state; it does not persist or prove identity with the earlier preview.",
    );
    expect(readme).not.toContain("Inspect pinned source contents");
    expect(readme).not.toContain("Preview destinations");
    expect(readme).not.toContain("Apply the exact plan");
    expect(readme).not.toContain("exact rerun command");
    expect(readme).not.toContain("applying a plan with safety findings");
  });

  it("links concise README verification guidance to the detailed testing contract", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");
    expect(readme).toMatch(/\[[^\]]*testing[^\]]*\]\(\.\/docs\/TESTING\.md\)/i);
  });

  it("builds independently of repository dist and proves the documented outcomes offline", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/readme-product-flow.mjs"), "--json"],
      {
        cwd: repositoryRoot,
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    expect(JSON.parse(stdout)).toMatchObject({
      build: "isolated",
      mode: "offline-fixture",
      verified: {
        stateDirectories: true,
        installRecords: true,
        fileHashes: true,
        snapshots: true,
        libraryTransitions: true,
        manifestLockConsistency: true,
        privacySafeCard: true,
        rollbackRestoration: true,
        unmanagedSentinelPreserved: true,
      },
    });
  }, 65_000);

  it.runIf(process.env.LOADOUT_TEST_LIVE_CATALOG === "1")(
    "proves pinned Stable catalog installation before the local rollback journey",
    async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          resolve(repositoryRoot, "scripts/readme-product-flow.mjs"),
          "--live-catalog",
          "--json",
        ],
        {
          cwd: repositoryRoot,
          timeout: 240_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      const result = JSON.parse(stdout);
      expect(result).toMatchObject({
        build: "isolated",
        mode: "live-catalog",
        liveCatalog: {
          pinnedCommits: true,
          persistedRecords: true,
          fileHashes: true,
          snapshot: true,
          rollback: true,
          filesystemRestoration: true,
        },
      });
      expect(result.liveCatalog.packages).toBeGreaterThan(0);
    },
    245_000,
  );
});
