import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { InstallState } from "../src/shared/types.js";
import {
  buildCompatibilityIntelligence,
  compatibilityFreshness,
  parseCompatibilityNoticeSet,
  signCompatibilityNoticeSet,
  verifySignedCompatibilityNoticeSet,
  type CompatibilityNoticeSet,
} from "../src/core/compatibility-intelligence.js";
import type { AgentVersionEvidence } from "../src/core/agent-versions.js";

const NOW = new Date("2026-07-16T12:00:00.000Z");

function breakingFeed(
  overrides: Partial<CompatibilityNoticeSet> = {},
): CompatibilityNoticeSet {
  return parseCompatibilityNoticeSet({
    schemaVersion: 1,
    generatedAt: "2026-07-16T11:00:00.000Z",
    expiresAt: "2026-07-17T11:00:00.000Z",
    notices: [
      {
        schemaVersion: 1,
        id: "claude-skills-path-2026-07",
        agent: "claude-code",
        kind: "path-change",
        severity: "breaking",
        summary: "Claude Code moved its managed skill discovery directory.",
        issuedAt: "2026-07-16T10:00:00.000Z",
        expiresAt: "2026-08-16T10:00:00.000Z",
        versionRange: {
          minInclusive: "2.0.0",
          maxExclusive: "3.0.0",
          includePrerelease: false,
        },
        platforms: ["windows", "macos", "linux"],
        affected: {
          packageIds: [],
          componentTypes: ["skill"],
          pathPrefixes: [".claude/skills"],
          recipeIds: [],
          providerIds: [],
          modelIds: [],
        },
        evidence: {
          sourceUrl: "https://docs.example.test/claude/path-migration",
          observedAt: "2026-07-16T10:00:00.000Z",
          confidence: "verified",
        },
        migration: {
          kind: "move",
          fromPath: ".claude/skills",
          toPath: ".claude/new-skills",
          instructions: [
            "Review the preview, then use a snapshot-backed transaction.",
          ],
          automaticEligible: true,
        },
        uncertainty:
          "This notice covers the documented CLI path and does not claim editor-extension parity.",
      },
    ],
    ...overrides,
  });
}

function managedState(
  path = "/Users/test/.claude/skills/review",
): InstallState {
  return {
    version: 1,
    installs: [
      {
        packageId: "review-pack",
        targetAgents: ["claude-code"],
        files: [{ path: `${path}/SKILL.md`, sha256: "a".repeat(64) }],
        snapshotId: "snapshot-1",
        installedAt: "2026-07-15T00:00:00.000Z",
      },
      {
        packageId: "codex-only",
        targetAgents: ["codex"],
        files: [
          {
            path: "/Users/test/.agents/skills/other/SKILL.md",
            sha256: "b".repeat(64),
          },
        ],
        snapshotId: "snapshot-2",
        installedAt: "2026-07-15T00:00:00.000Z",
      },
    ],
    activations: [
      {
        packageId: "review-pack",
        unitId: "review",
        agent: "claude-code",
        cacheState: "downloaded",
        reviewState: "reviewed",
        installationState: "installed",
        activationState: "active",
        libraryPath: "/tmp/library/review",
        targets: [
          {
            activePath: path,
            libraryRelativePath: "review",
          },
        ],
        libraryFiles: [],
        updatedAt: "2026-07-15T00:00:00.000Z",
      },
    ],
    mcpInstalls: [],
  };
}

function version(value = "2.4.1"): AgentVersionEvidence {
  return {
    agent: "claude-code",
    displayName: "Claude Code",
    installed: true,
    binary: "claude",
    status: "detected",
    version: value,
    releaseChannel: value.includes("-") ? "prerelease" : "stable",
    command: ["claude", "--version"],
    message: "fixture",
  };
}

describe("compatibility notice trust boundary", () => {
  it("accepts a strict bounded feed and rejects unknown or malformed fields", () => {
    expect(breakingFeed().notices).toHaveLength(1);
    expect(() =>
      parseCompatibilityNoticeSet({
        ...breakingFeed(),
        unexpected: "not signed into the schema",
      }),
    ).toThrow();
    expect(() =>
      parseCompatibilityNoticeSet({
        ...breakingFeed(),
        notices: [
          {
            ...breakingFeed().notices[0],
            migration: {
              ...breakingFeed().notices[0].migration,
              toPath: "../../outside",
            },
          },
        ],
      }),
    ).toThrow(/safe agent-relative path/);
  });

  it("verifies signed notices and rejects payload tampering", () => {
    const pair = generateKeyPairSync("ed25519");
    const privateKey = pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const publicKey = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const envelope = signCompatibilityNoticeSet(
      breakingFeed(),
      privateKey,
      "2026-07-16T11:01:00.000Z",
    );
    expect(
      verifySignedCompatibilityNoticeSet(envelope, publicKey).feed.notices,
    ).toHaveLength(1);
    expect(() =>
      verifySignedCompatibilityNoticeSet(
        {
          ...envelope,
          payload: { ...envelope.payload, notices: [] },
        },
        publicKey,
      ),
    ).toThrow(/signature is invalid/);
  });
});

describe("compatibility impact and migration previews", () => {
  it("finds only affected managed content and previews a breaking path without mutation", () => {
    const state = managedState();
    const before = structuredClone(state);
    const report = buildCompatibilityIntelligence({
      versions: [version()],
      state,
      feed: breakingFeed(),
      sourceStatus: "verified",
      now: NOW,
      platform: "darwin",
    });
    expect(report.freshness.status).toBe("fresh");
    expect(report.assessments[0]).toMatchObject({ applicability: "applies" });
    expect(report.affectedManagedContent).toHaveLength(2);
    expect(report.affectedManagedContent.map((item) => item.packageId)).toEqual(
      ["review-pack", "review-pack"],
    );
    expect(report.migrationPreview).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageId: "review-pack",
          sourcePath: "/Users/test/.claude/skills/review",
          targetPath: "/Users/test/.claude/new-skills/review",
          automaticEligible: true,
          requiresApproval: true,
        }),
      ]),
    );
    expect(report.mutationPerformed).toBe(false);
    expect(state).toEqual(before);
  });

  it("matches Windows managed paths and keeps native path evidence in the preview", () => {
    const report = buildCompatibilityIntelligence({
      versions: [version()],
      state: managedState("C:\\Users\\test\\.claude\\skills\\review"),
      feed: breakingFeed(),
      sourceStatus: "verified",
      now: NOW,
      platform: "win32",
    });
    expect(report.affectedManagedContent).toHaveLength(2);
    expect(report.migrationPreview.map((step) => step.targetPath)).toEqual(
      expect.arrayContaining([
        "C:/Users/test/.claude/new-skills/review",
        "C:/Users/test/.claude/new-skills/review/SKILL.md",
      ]),
    );
  });

  it("treats prereleases as potential when a notice does not explicitly cover them", () => {
    const report = buildCompatibilityIntelligence({
      versions: [version("2.5.0-beta.2")],
      state: managedState(),
      feed: breakingFeed(),
      sourceStatus: "verified",
      now: NOW,
      platform: "linux",
    });
    expect(report.assessments[0]).toMatchObject({ applicability: "potential" });
    expect(report.assessments[0].reason).toMatch(
      /prerelease not explicitly covered/,
    );
    expect(report.uncertainty.join(" ")).toMatch(
      /absence of a notice is not compatibility evidence/,
    );
  });

  it("does not apply a notice outside its signed version or platform range", () => {
    const versionReport = buildCompatibilityIntelligence({
      versions: [version("3.1.0")],
      state: managedState(),
      feed: breakingFeed(),
      sourceStatus: "verified",
      now: NOW,
      platform: "darwin",
    });
    expect(versionReport.assessments[0]).toMatchObject({
      applicability: "not-applicable",
      affectedManagedContent: [],
    });
    const platformReport = buildCompatibilityIntelligence({
      versions: [version()],
      state: managedState(),
      feed: breakingFeed(),
      sourceStatus: "verified",
      now: NOW,
      platform: "aix",
    });
    expect(platformReport.assessments[0].applicability).toBe("not-applicable");
  });
});

describe("compatibility freshness and offline uncertainty", () => {
  it("reports a missing feed without making a compatibility claim", () => {
    const report = buildCompatibilityIntelligence({
      versions: [version()],
      state: managedState(),
      sourceStatus: "missing",
      now: NOW,
    });
    expect(report.freshness).toMatchObject({
      status: "unavailable",
      sourceStatus: "missing",
    });
    expect(report.assessments).toEqual([]);
    expect(report.uncertainty.join(" ")).toMatch(/compatibility is unknown/);
  });

  it("uses a verified offline cache with explicit uncertainty", () => {
    const report = buildCompatibilityIntelligence({
      versions: [version()],
      state: managedState(),
      feed: breakingFeed(),
      sourceStatus: "offline-cache",
      now: NOW,
      platform: "linux",
    });
    expect(report.freshness).toMatchObject({
      status: "fresh",
      sourceStatus: "offline-cache",
    });
    expect(report.freshness.message).toMatch(/previously verified.*offline/);
  });

  it("downgrades expired and future-dated evidence to uncertain", () => {
    const stale = breakingFeed({ expiresAt: "2026-07-16T11:30:00.000Z" });
    expect(compatibilityFreshness(stale, "offline-cache", NOW).status).toBe(
      "stale",
    );
    const report = buildCompatibilityIntelligence({
      versions: [version()],
      state: managedState(),
      feed: stale,
      sourceStatus: "offline-cache",
      now: NOW,
      platform: "linux",
    });
    expect(report.assessments[0].applicability).toBe("potential");

    const future = breakingFeed({
      generatedAt: "2026-07-17T11:00:00.000Z",
      expiresAt: "2026-07-18T11:00:00.000Z",
    });
    expect(compatibilityFreshness(future, "verified", NOW).status).toBe(
      "invalid",
    );
  });
});
