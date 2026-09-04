import { Command } from "commander";
import { SessionManager } from "../core/coordination/session-manager.js";
import { createProviderAdapters } from "../core/coordination/runtime.js";
import { acquireBridgeLease } from "../core/coordination/bridge-lease.js";

const SUPPORTED_PROVIDERS = new Set(["claude-code", "codex"]);

export interface ProviderSessionRef {
  provider: string;
  sessionId: string;
}

export function parseProviderSessionRef(value: string): ProviderSessionRef {
  const separator = value.indexOf(":");
  if (separator < 1) {
    throw new Error(
      `Invalid session reference '${value}'; expected provider:session-id`,
    );
  }
  const provider = value.slice(0, separator);
  const sessionId = value.slice(separator + 1).trim();
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(
      `Unsupported provider '${provider}'; supported providers: claude-code, codex`,
    );
  }
  if (!sessionId) {
    throw new Error(
      `Invalid session reference '${value}'; session id is empty`,
    );
  }
  return { provider, sessionId };
}

function manager(
  projectRoot: string,
  autoSubmit: boolean,
  maxAutoTurnsPerSession = 20,
): SessionManager {
  return new SessionManager({
    projectRoot,
    adapters: createProviderAdapters(),
    autoSubmit,
    maxAutoTurnsPerSession,
    onPendingEvents(session, events) {
      console.error(
        `Could not route ${events.length} event(s) to ${session.provider}:${session.sessionId}; the session may be busy or unavailable.`,
      );
    },
    ...(autoSubmit
      ? {
          onTurnCompleted(session, response) {
            console.log(
              `\n[${session.provider}:${session.sessionId}] ${response ?? "Coordination turn completed."}`,
            );
          },
        }
      : {}),
  });
}

async function withStoppedManager<T>(
  projectRoot: string,
  operation: (sessions: SessionManager) => Promise<T>,
): Promise<T> {
  const sessions = manager(projectRoot, false);
  await sessions.start();
  try {
    return await operation(sessions);
  } finally {
    await sessions.stop();
  }
}

/** Register opt-in provider-driven turns under `loadout coord agents`. */
export function registerCoordinationSessions(coord: Command): void {
  const agents = coord
    .command("agents")
    .description(
      "Bridge provider sessions so coordination events become follow-up turns (beta)",
    );

  agents
    .command("detect")
    .description("Detect supported provider runtimes")
    .option("--json", "machine-readable JSON output")
    .action(async (options: { json?: boolean }) => {
      const providers = await withStoppedManager(
        process.cwd(),
        async (sessions) => sessions.detectProviders(),
      );
      if (options.json) {
        console.log(JSON.stringify(providers, null, 2));
      } else if (providers.length === 0) {
        console.log("No supported provider runtimes detected.");
      } else {
        for (const provider of providers) {
          console.log(`${provider.provider}: ${provider.version}`);
        }
      }
    });

  agents
    .command("list")
    .description("List sessions tracked by this project")
    .option("--json", "machine-readable JSON output")
    .action(async (options: { json?: boolean }) => {
      const tracked = await withStoppedManager(
        process.cwd(),
        async (sessions) => sessions.getSessions(),
      );
      if (options.json) {
        console.log(JSON.stringify(tracked, null, 2));
      } else if (tracked.length === 0) {
        console.log("No provider sessions tracked for this project.");
      } else {
        for (const session of tracked) {
          console.log(
            `${session.provider}:${session.sessionId}  cursor=${session.cursor}  ${session.active ? "active" : "detached"}`,
          );
        }
      }
    });

  agents
    .command("start")
    .description("Start and track a provider session (runs a paid agent turn)")
    .argument("<provider>", "claude-code or codex")
    .argument("[prompt...]", "initial task prompt")
    .option("--json", "machine-readable JSON output")
    .action(
      async (
        provider: string,
        prompt: string[],
        options: { json?: boolean },
      ) => {
        if (!SUPPORTED_PROVIDERS.has(provider)) {
          throw new Error(
            `Unsupported provider '${provider}'; use claude-code or codex`,
          );
        }
        const result = await withStoppedManager(
          process.cwd(),
          async (sessions) => {
            const session = await sessions.startSession(
              provider,
              process.cwd(),
              prompt.join(" "),
            );
            return {
              session,
              response: sessions.getLastResponse(session.sessionId),
            };
          },
        );
        const { session, response } = result;
        if (options.json) {
          console.log(JSON.stringify({ session, response }, null, 2));
        } else {
          console.log(`Started ${provider}:${session.sessionId}`);
          if (response) console.log(`\n${response}`);
          console.log(
            `Keep it live with: loadout coord agents bridge ${provider}:${session.sessionId}`,
          );
        }
      },
    );

  agents
    .command("attach")
    .description("Track an existing provider session without running a turn")
    .argument("<session>", "provider:session-id")
    .option("--json", "machine-readable JSON output")
    .action(async (reference: string, options: { json?: boolean }) => {
      const parsed = parseProviderSessionRef(reference);
      const session = await withStoppedManager(
        process.cwd(),
        async (sessions) =>
          sessions.attachSession(
            parsed.provider,
            parsed.sessionId,
            process.cwd(),
          ),
      );
      if (options.json) {
        console.log(JSON.stringify(session, null, 2));
      } else {
        console.log(`Attached ${parsed.provider}:${parsed.sessionId}`);
      }
    });

  agents
    .command("send")
    .description("Send one follow-up turn to a tracked provider session")
    .argument("<session-id>", "tracked provider session id")
    .argument("<message...>", "follow-up message")
    .option("--json", "machine-readable JSON output")
    .action(
      async (
        sessionId: string,
        message: string[],
        options: { json?: boolean },
      ) => {
        const result = await withStoppedManager(
          process.cwd(),
          async (sessions) => {
            const tracked = sessions
              .getSessions()
              .find((session) => session.sessionId === sessionId);
            if (!tracked) {
              throw new Error(
                `Session ${sessionId} is not tracked; use 'loadout coord agents attach provider:${sessionId}' first`,
              );
            }
            await sessions.resumeSession(
              tracked.provider,
              tracked.sessionId,
              process.cwd(),
            );
            const sent = await sessions.submitTurn(
              sessionId,
              message.join(" "),
            );
            return {
              sent,
              response: sessions.getLastResponse(sessionId),
            };
          },
        );
        if (!result.sent) {
          throw new Error(
            `Provider session ${sessionId} did not accept the turn`,
          );
        }
        if (options.json) {
          console.log(
            JSON.stringify({
              sent: true,
              sessionId,
              response: result.response,
            }),
          );
        } else {
          console.log(`Sent follow-up turn to ${sessionId}`);
          if (result.response) console.log(`\n${result.response}`);
        }
      },
    );

  agents
    .command("bridge")
    .description(
      "Keep sessions connected and route coordination events as follow-up turns",
    )
    .argument("<sessions...>", "one or more provider:session-id references")
    .option(
      "--max-turns <n>",
      "maximum automatic turns per session before pausing",
      Number,
      20,
    )
    .action(async (references: string[], options: { maxTurns: number }) => {
      const projectRoot = process.cwd();
      const lease = await acquireBridgeLease(projectRoot);
      const sessions = manager(projectRoot, true, options.maxTurns);
      try {
        await sessions.start();
        for (const reference of references) {
          const parsed = parseProviderSessionRef(reference);
          await sessions.attachSession(
            parsed.provider,
            parsed.sessionId,
            projectRoot,
          );
        }

        console.log(
          `Bridge active for ${references.join(", ")}. Coordination events will be delivered at safe turn boundaries.`,
        );
        console.log("Press Ctrl+C to stop.");

        await new Promise<void>((resolve) => {
          const stop = () => resolve();
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
        });
      } finally {
        await sessions.stop();
        await lease.release();
      }
    });
}
