import { describe, expect, it, vi } from "vitest";
import {
  checkForUpdates,
  startUpdateWatcher,
} from "../src/core/update-watch.js";

describe("read-only update watcher", () => {
  it("summarizes pending updates without applying them", async () => {
    const notification = await checkForUpdates(async () => [
      {
        packageId: "demo",
        status: "update-available",
        action: "Review first",
        targetAgents: ["codex"],
      },
    ]);
    expect(notification.message).toContain("1 update");
    expect(notification.updates[0]?.packageId).toBe("demo");
  });

  it("notifies immediately and can be stopped", async () => {
    vi.useFakeTimers();
    try {
      const notifications: string[] = [];
      const stop = startUpdateWatcher({
        intervalMs: 1_000,
        check: async () => [],
        notify: (notification) => notifications.push(notification.message),
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(notifications).toHaveLength(1);
      stop();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(notifications).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
