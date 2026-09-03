import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { emit } from "../src/core/coordination/coordinator.js";
import {
  watchCoordination,
  formatLiveEvent,
} from "../src/core/coordination/watcher.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loadout-watch-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("coordination watcher", () => {
  it("detects new events via file watch", async () => {
    // Seed initial event
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "task",
      description: "Initial task",
    });

    const received: string[] = [];

    const watcher = await watchCoordination(root, {
      onEvents(events) {
        for (const e of events) received.push(e.description);
      },
    });

    // Write a new event
    await emit(root, {
      from: "codex",
      to: "*",
      type: "contract",
      description: "New API",
      payload: { name: "api", revision: 1, body: "types" },
    });

    // Wait for debounce + fs.watch
    await new Promise((resolve) => setTimeout(resolve, 300));

    watcher.stop();

    expect(received).toContain("New API");
    expect(received).not.toContain("Initial task");
  });

  it("filters events by agent", async () => {
    const received: string[] = [];

    const watcher = await watchCoordination(root, {
      agent: "codex",
      cursor: -1,
      onEvents(events) {
        for (const e of events) received.push(e.description);
      },
    });

    await emit(root, {
      from: "claude-code",
      to: "codex",
      type: "task",
      description: "For codex",
    });

    await emit(root, {
      from: "claude-code",
      to: "other-agent",
      type: "task",
      description: "Not for codex",
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    watcher.stop();

    expect(received).toContain("For codex");
    expect(received).not.toContain("Not for codex");
  });
});

describe("formatLiveEvent", () => {
  it("formats contract events with payload details", () => {
    const text = formatLiveEvent({
      id: "abc",
      seq: 0,
      type: "contract",
      from: "claude-code",
      to: "*",
      description: "API v1",
      timestamp: "2026-09-03T10:30:00.000Z",
      payload: { name: "auth-api", revision: 1, format: "typescript" },
    });
    expect(text).toContain("[contract]");
    expect(text).toContain("auth-api rev1");
    expect(text).toContain("typescript");
  });

  it("formats ownership events", () => {
    const text = formatLiveEvent({
      id: "def",
      seq: 1,
      type: "ownership",
      from: "codex",
      to: "*",
      description: "Codex owns frontend",
      timestamp: "2026-09-03T10:31:00.000Z",
      payload: { paths: ["src/components/"], mode: "exclusive" },
    });
    expect(text).toContain("🔒");
    expect(text).toContain("exclusive");
    expect(text).toContain("src/components/");
  });
});
