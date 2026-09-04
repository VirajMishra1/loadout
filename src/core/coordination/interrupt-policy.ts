/**
 * Interrupt policy for coordination events.
 *
 * Determines whether an incoming event should interrupt an active agent
 * session immediately, queue for the next safe boundary, or be silently
 * recorded for later consumption.
 *
 * Policies are configurable per project via .handoff/policy.json.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CoordinationEvent } from "./events.js";

export type InterruptLevel = "immediate" | "boundary" | "passive";

export interface InterruptRule {
  /** Event type to match. "*" matches all. */
  type: string;
  /** Source agent pattern. "*" matches all. */
  from: string;
  /** How to handle the event. */
  level: InterruptLevel;
}

export interface InterruptPolicy {
  /** Default level for unmatched events. */
  defaultLevel: InterruptLevel;
  /** Ordered rules — first match wins. */
  rules: InterruptRule[];
}

const DEFAULT_POLICY: InterruptPolicy = {
  defaultLevel: "boundary",
  rules: [
    // Ownership conflicts should interrupt immediately
    { type: "ownership", from: "*", level: "immediate" },
    // Contract changes interrupt at boundary
    { type: "contract", from: "*", level: "boundary" },
    // Decisions interrupt at boundary
    { type: "decision", from: "*", level: "boundary" },
    // Public design-room turns route sequentially at safe boundaries
    { type: "discussion", from: "*", level: "boundary" },
    // Progress updates are passive
    { type: "update", from: "*", level: "passive" },
    // Acks are always passive
    { type: "ack", from: "*", level: "passive" },
    // Tasks should interrupt at boundary
    { type: "task", from: "*", level: "boundary" },
    // Errors interrupt immediately
    { type: "error", from: "*", level: "immediate" },
    // Done events at boundary
    { type: "done", from: "*", level: "boundary" },
  ],
};

const policySchema = z
  .object({
    defaultLevel: z.enum(["immediate", "boundary", "passive"]).optional(),
    rules: z
      .array(
        z
          .object({
            type: z.string().trim().min(1).max(128),
            from: z.string().trim().min(1).max(128),
            level: z.enum(["immediate", "boundary", "passive"]),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

export function evaluatePolicy(
  event: CoordinationEvent,
  policy: InterruptPolicy = DEFAULT_POLICY,
): InterruptLevel {
  for (const rule of policy.rules) {
    const typeMatch = rule.type === "*" || rule.type === event.type;
    const fromMatch = rule.from === "*" || rule.from === event.from;
    if (typeMatch && fromMatch) {
      return rule.level;
    }
  }
  return policy.defaultLevel;
}

export function categorizeEvents(
  events: CoordinationEvent[],
  policy: InterruptPolicy = DEFAULT_POLICY,
): {
  immediate: CoordinationEvent[];
  boundary: CoordinationEvent[];
  passive: CoordinationEvent[];
} {
  const result = {
    immediate: [] as CoordinationEvent[],
    boundary: [] as CoordinationEvent[],
    passive: [] as CoordinationEvent[],
  };

  for (const event of events) {
    const level = evaluatePolicy(event, policy);
    result[level].push(event);
  }

  return result;
}

export async function loadPolicy(
  projectRoot: string,
): Promise<InterruptPolicy> {
  try {
    const raw = await readFile(
      join(projectRoot, ".handoff", "policy.json"),
      "utf-8",
    );
    const parsed = policySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_POLICY;
    const custom = parsed.data;
    return {
      defaultLevel: custom.defaultLevel ?? DEFAULT_POLICY.defaultLevel,
      rules: custom.rules ?? DEFAULT_POLICY.rules,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

export { DEFAULT_POLICY };
