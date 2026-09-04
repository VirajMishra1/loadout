import { z } from "zod";

// ---------------------------------------------------------------------------
// Event type enum — superset of handoff message types
// ---------------------------------------------------------------------------

export const COORDINATION_EVENT_TYPES = [
  // Original handoff types
  "task",
  "handoff",
  "question",
  "done",
  "status",
  "error",
  "cancel",
  // Live collaboration types (Phase 1)
  "contract",
  "ownership",
  "decision",
  "update",
  "ack",
  "discussion",
] as const;

export type CoordinationEventType = (typeof COORDINATION_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Typed payloads for collaboration events
// ---------------------------------------------------------------------------

export const contractPayloadSchema = z.object({
  /** A stable name for this contract, e.g. "auth-api" or "db-schema". */
  name: z.string().trim().min(1).max(200),
  /** Monotonically increasing version for this contract name. */
  revision: z.number().int().positive(),
  /** The contract body — OpenAPI fragment, TypeScript types, SQL, etc. */
  body: z.string().max(100_000),
  /** MIME-ish hint: "typescript", "openapi-yaml", "sql", "json-schema". */
  format: z.string().trim().min(1).max(50).optional(),
});

export const ownershipPayloadSchema = z.object({
  /** File or directory paths this agent claims. Relative to project root. */
  paths: z.array(z.string().trim().min(1).max(1_024)).min(1).max(256),
  /** "exclusive" blocks other agents; "shared" allows concurrent reads. */
  mode: z.enum(["exclusive", "shared", "release"]),
  /** Optional reason for the claim. */
  reason: z.string().max(500).optional(),
});

export const decisionPayloadSchema = z.object({
  /** Short title: "Use Zod for validation", "REST over GraphQL". */
  title: z.string().trim().min(1).max(200),
  /** The rationale. */
  rationale: z.string().max(10_000),
  /** ID of the decision this supersedes, if any. */
  supersedes: z.string().trim().min(1).max(128).optional(),
  /** Discussion thread that produced this decision, when applicable. */
  discussionId: z.string().trim().min(1).max(128).optional(),
});

export const updatePayloadSchema = z.object({
  /** Files touched since last update. */
  files: z.array(z.string().max(1_024)).max(256).optional(),
  /** Commands run and their outcomes. */
  commands: z
    .array(
      z.object({
        command: z.string().max(500),
        exitCode: z.number().int().optional(),
        summary: z.string().max(1000).optional(),
      }),
    )
    .max(20)
    .optional(),
  /** Free-form progress note. */
  note: z.string().max(5000).optional(),
  /** Blockers preventing further progress. */
  blockers: z.array(z.string().max(500)).max(10).optional(),
  /** What this agent plans to do next. */
  next: z.string().max(1000).optional(),
});

export const ackPayloadSchema = z.object({
  /** Sequence number of the event being acknowledged. */
  eventSeq: z.number().int().nonnegative(),
  /** Optional note about what the agent did with this event. */
  note: z.string().max(1000).optional(),
});

export const discussionPayloadSchema = z
  .object({
    /** Stable ID shared by every event in one bounded design discussion. */
    threadId: z.string().trim().min(1).max(128),
    /** The semantic place of this statement in the discussion. */
    kind: z.enum([
      "started",
      "proposal",
      "critique",
      "revision",
      "summary",
      "closed",
    ]),
    /** Zero for lifecycle events, otherwise the user-visible round number. */
    round: z.number().int().min(0).max(8),
    /** The participant function represented by this event. */
    role: z.enum(["system", "proposer", "reviewer"]),
    /** Explicit public output. Hidden provider reasoning is never requested. */
    content: z.string().trim().min(1).max(16_384),
    /** Present on the opening event so state can be reconstructed from JSONL. */
    participants: z
      .tuple([
        z.string().trim().min(1).max(128),
        z.string().trim().min(1).max(128),
      ])
      .optional(),
    /** Event ID this statement directly answers. */
    replyTo: z.string().trim().min(1).max(128).optional(),
    /** Alternatives preserved by the final lifecycle event. */
    alternatives: z
      .array(z.string().trim().min(1).max(2_000))
      .max(10)
      .optional(),
    /** Disagreements or evidence gaps the final decision does not conceal. */
    unresolved: z.array(z.string().trim().min(1).max(2_000)).max(10).optional(),
    /** Set on the terminal event so failures cannot be mistaken for decisions. */
    outcome: z.enum(["decided", "failed"]).optional(),
  })
  .strict();

export type ContractPayload = z.infer<typeof contractPayloadSchema>;
export type OwnershipPayload = z.infer<typeof ownershipPayloadSchema>;
export type DecisionPayload = z.infer<typeof decisionPayloadSchema>;
export type UpdatePayload = z.infer<typeof updatePayloadSchema>;
export type AckPayload = z.infer<typeof ackPayloadSchema>;
export type DiscussionPayload = z.infer<typeof discussionPayloadSchema>;

// ---------------------------------------------------------------------------
// Coordination event — extends HandoffMessage with seq + typed payload
// ---------------------------------------------------------------------------

export const coordinationEventSchema = z.object({
  id: z.string().trim().min(1).max(128),
  seq: z.number().int().nonnegative(),
  type: z.enum(COORDINATION_EVENT_TYPES),
  from: z.string().trim().min(1).max(128),
  to: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(8_192),
  context: z.string().max(65_536).optional(),
  timestamp: z.iso.datetime({ offset: true }),
  resolves: z.string().trim().min(1).max(128).optional(),
  /** Typed payload — shape depends on `type`. */
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type CoordinationEvent = z.infer<typeof coordinationEventSchema>;

/** Validate the typed payload matches the event type. */
export function validatePayload(
  type: CoordinationEventType,
  payload: unknown,
): { success: true; data: unknown } | { success: false; error: string } {
  const schemas: Partial<Record<CoordinationEventType, z.ZodType<unknown>>> = {
    contract: contractPayloadSchema,
    ownership: ownershipPayloadSchema,
    decision: decisionPayloadSchema,
    update: updatePayloadSchema,
    ack: ackPayloadSchema,
    discussion: discussionPayloadSchema,
  };

  const schema = schemas[type];
  if (!schema) {
    // Original handoff types don't require typed payloads
    return { success: true, data: payload };
  }

  if (!payload) {
    return { success: false, error: `Event type '${type}' requires a payload` };
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues
        .map((i) => `${i.path.join(".") || "payload"}: ${i.message}`)
        .join("; "),
    };
  }
  return { success: true, data: result.data };
}
