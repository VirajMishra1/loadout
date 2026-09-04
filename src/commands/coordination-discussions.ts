import { Command } from "commander";
import {
  formatDiscussion,
  getDiscussion,
  listDiscussions,
  requiredDiscussionTurns,
  runDiscussion,
  validateDiscussionOptions,
  type DiscussionParticipant,
} from "../core/coordination/discussion.js";
import { SessionManager } from "../core/coordination/session-manager.js";
import { createProviderAdapters } from "../core/coordination/runtime.js";
import { acquireBridgeLease } from "../core/coordination/bridge-lease.js";
import {
  parseProviderSessionRef,
  type ProviderSessionRef,
} from "./coordination-sessions.js";

type DiscussionProvider = "claude-code" | "codex";

export interface DiscussionSelectionItem {
  provider: DiscussionProvider;
  sessionId?: string;
}

export interface DiscussionSelection {
  mode: "fresh" | "existing";
  participants: [DiscussionSelectionItem, DiscussionSelectionItem];
}

export interface DiscussionSelectionOptions {
  agents?: string;
  sessions?: string[];
  proposer?: string;
}

export interface DiscussionSessionPort {
  startSession(
    provider: string,
    cwd: string,
    prompt?: string,
    timeout?: number,
  ): Promise<{ sessionId: string }>;
  submitTurn(
    sessionId: string,
    message: string,
    timeout?: number,
  ): Promise<boolean>;
  getLastResponse(sessionId: string): string | undefined;
}

function assertBothProviders(
  values: string[],
): asserts values is [DiscussionProvider, DiscussionProvider] {
  if (
    values.length !== 2 ||
    new Set(values).size !== 2 ||
    !values.includes("claude-code") ||
    !values.includes("codex")
  ) {
    throw new Error(
      "A discussion requires exactly claude-code and codex, each once",
    );
  }
}

export function parseDiscussionAgents(
  value: string,
): [DiscussionProvider, DiscussionProvider] {
  const providers = value
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  assertBothProviders(providers);
  return providers;
}

export function parseDiscussionSessions(
  values: string[],
): [ProviderSessionRef, ProviderSessionRef] {
  if (values.length !== 2) {
    throw new Error("A discussion requires exactly two provider sessions");
  }
  const sessions = values.map(parseProviderSessionRef) as [
    ProviderSessionRef,
    ProviderSessionRef,
  ];
  assertBothProviders(sessions.map((session) => session.provider));
  if (sessions[0].sessionId === sessions[1].sessionId) {
    throw new Error("Discussion session IDs must be different");
  }
  return sessions;
}

export function resolveDiscussionSelection(
  options: DiscussionSelectionOptions,
): DiscussionSelection {
  if (options.agents && options.sessions) {
    throw new Error("Choose either --agents or --sessions, not both");
  }
  if (!options.agents && !options.sessions) {
    throw new Error("Discussion start requires --agents or --sessions");
  }

  const mode = options.agents ? "fresh" : "existing";
  const selected: [DiscussionSelectionItem, DiscussionSelectionItem] =
    options.agents
      ? (parseDiscussionAgents(options.agents).map((provider) => ({
          provider,
        })) as [DiscussionSelectionItem, DiscussionSelectionItem])
      : (parseDiscussionSessions(options.sessions ?? []).map((session) => ({
          provider: session.provider as DiscussionProvider,
          sessionId: session.sessionId,
        })) as [DiscussionSelectionItem, DiscussionSelectionItem]);

  if (options.proposer) {
    if (!selected.some((item) => item.provider === options.proposer)) {
      throw new Error(
        "--proposer must be claude-code or codex and be part of the discussion",
      );
    }
    selected.sort((left) => (left.provider === options.proposer ? -1 : 1));
  }
  return { mode, participants: selected };
}

export function discussionTimeoutMs(seconds: number): number {
  if (!Number.isSafeInteger(seconds) || seconds < 10 || seconds > 600) {
    throw new Error(
      "Discussion timeout must be an integer between 10 and 600 seconds",
    );
  }
  return seconds * 1_000;
}

/** Adapt a fresh or already-attached provider session to the discussion port. */
export function createSessionParticipant(
  sessions: DiscussionSessionPort,
  selection: DiscussionSelectionItem,
  role: "proposer" | "reviewer",
  cwd: string,
  timeoutMs?: number,
): DiscussionParticipant {
  let sessionId = selection.sessionId;
  return {
    agent: selection.provider,
    role,
    async respond(prompt: string): Promise<string> {
      if (!sessionId) {
        const started = await sessions.startSession(
          selection.provider,
          cwd,
          prompt,
          timeoutMs,
        );
        sessionId = started.sessionId;
      } else {
        const accepted = await sessions.submitTurn(
          sessionId,
          prompt,
          timeoutMs,
        );
        if (!accepted) {
          throw new Error(
            `${selection.provider}:${sessionId} rejected the discussion turn`,
          );
        }
      }
      return sessions.getLastResponse(sessionId) ?? "";
    },
  };
}

function createManager(projectRoot: string): SessionManager {
  return new SessionManager({
    projectRoot,
    adapters: createProviderAdapters(),
    autoSubmit: false,
  });
}

/** Register opt-in bounded provider discussions under `loadout coord discuss`. */
export function registerCoordinationDiscussions(coord: Command): void {
  const discuss = coord
    .command("discuss")
    .description("Bounded Claude Code ↔ Codex design discussions");

  discuss
    .command("list")
    .description("List recorded design discussions without running an agent")
    .option("--json", "machine-readable JSON output")
    .action(async (options: { json?: boolean }) => {
      const discussions = await listDiscussions(process.cwd());
      if (options.json) {
        console.log(JSON.stringify(discussions, null, 2));
      } else if (discussions.length === 0) {
        console.log("No design discussions recorded.");
      } else {
        for (const thread of discussions) {
          console.log(
            `${thread.threadId}  ${thread.status}  ${thread.participants.join(" ↔ ")}  ${thread.topic}`,
          );
        }
      }
    });

  discuss
    .command("show")
    .description(
      "Show one public discussion transcript without running an agent",
    )
    .argument("<thread-id>", "discussion thread ID")
    .option("--json", "machine-readable JSON output")
    .action(async (threadId: string, options: { json?: boolean }) => {
      const discussion = await getDiscussion(process.cwd(), threadId);
      if (!discussion) {
        throw new Error(`No discussion named '${threadId}'`);
      }
      console.log(
        options.json
          ? JSON.stringify(discussion, null, 2)
          : formatDiscussion(discussion),
      );
    });

  discuss
    .command("start")
    .description("Run a bounded design discussion (spends paid provider turns)")
    .argument("<topic>", "technical question for Claude Code and Codex")
    .option("--agents <providers>", "start fresh sessions: claude-code,codex")
    .option(
      "--sessions <references...>",
      "reuse provider sessions: claude-code:<id> codex:<id>",
    )
    .option("--proposer <provider>", "claude-code or codex")
    .option(
      "--rounds <n>",
      "rounds; each agent speaks once per round",
      Number,
      2,
    )
    .option("--max-turns <n>", "hard paid-turn budget", Number, 17)
    .option(
      "--timeout <seconds>",
      "timeout for each paid provider turn",
      Number,
      120,
    )
    .option("--thread-id <id>", "stable discussion ID")
    .option(
      "--initiator <name>",
      "coordination identity starting the discussion",
      "user",
    )
    .option("--json", "machine-readable final output")
    .action(
      async (
        topic: string,
        options: {
          agents?: string;
          sessions?: string[];
          proposer?: string;
          rounds: number;
          maxTurns: number;
          timeout: number;
          threadId?: string;
          initiator: string;
          json?: boolean;
        },
      ) => {
        const projectRoot = process.cwd();
        const selection = resolveDiscussionSelection(options);
        const timeoutMs = discussionTimeoutMs(options.timeout);
        const noop = async () => "validated only";
        validateDiscussionOptions({
          topic,
          rounds: options.rounds,
          maxTurns: options.maxTurns,
          participants: [
            {
              agent: selection.participants[0].provider,
              role: "proposer",
              respond: noop,
            },
            {
              agent: selection.participants[1].provider,
              role: "reviewer",
              respond: noop,
            },
          ],
        });
        const plannedTurns = requiredDiscussionTurns(options.rounds);
        console.error(
          `Starting bounded discussion: exactly ${plannedTurns} paid provider turns (${options.rounds} round(s) plus synthesis).`,
        );

        const lease = await acquireBridgeLease(projectRoot);
        const sessions = createManager(projectRoot);
        try {
          await sessions.start();
          if (selection.mode === "existing") {
            for (const item of selection.participants) {
              await sessions.attachSession(
                item.provider,
                item.sessionId!,
                projectRoot,
              );
            }
          }
          const result = await runDiscussion(projectRoot, {
            topic,
            rounds: options.rounds,
            maxTurns: options.maxTurns,
            ...(options.threadId ? { threadId: options.threadId } : {}),
            initiatedBy: options.initiator,
            participants: [
              createSessionParticipant(
                sessions,
                selection.participants[0],
                "proposer",
                projectRoot,
                timeoutMs,
              ),
              createSessionParticipant(
                sessions,
                selection.participants[1],
                "reviewer",
                projectRoot,
                timeoutMs,
              ),
            ],
          });
          console.log(
            options.json
              ? JSON.stringify(result, null, 2)
              : formatDiscussion(result.state),
          );
        } finally {
          await sessions.stop();
          await lease.release();
        }
      },
    );
}
