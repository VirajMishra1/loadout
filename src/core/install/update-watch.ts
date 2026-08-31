import { buildUpdatePlan, type UpdatePlan } from "./update.js";

export interface UpdateNotification {
  checkedAt: string;
  updates: UpdatePlan[];
  message: string;
}

export interface UpdateWatcherOptions {
  intervalMs: number;
  check?: () => Promise<UpdatePlan[]>;
  notify: (notification: UpdateNotification) => void;
}

export async function checkForUpdates(
  check: () => Promise<UpdatePlan[]> = buildUpdatePlan,
): Promise<UpdateNotification> {
  const updates = await check();
  const pending = updates.filter((item) => item.status === "update-available");
  return {
    checkedAt: new Date().toISOString(),
    updates,
    message: pending.length
      ? `${pending.length} update(s) available; review the diff before applying.`
      : "No tracked updates require action.",
  };
}

/** Start a read-only watcher. It never applies updates or changes agent files. */
export function startUpdateWatcher(options: UpdateWatcherOptions): () => void {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1_000)
    throw new Error("Update watcher interval must be at least 1000ms");
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    try {
      options.notify(await checkForUpdates(options.check));
    } catch (error) {
      options.notify({
        checkedAt: new Date().toISOString(),
        updates: [],
        message: `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  void run();
  const timer = setInterval(() => void run(), options.intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
