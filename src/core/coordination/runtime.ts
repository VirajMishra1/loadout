/** Composition boundary for optional provider-driven coordination. */

import { Codex } from "@openai/codex-sdk";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { CodexAdapter, type CodexSdkDriver } from "./adapters/codex.js";
import type { AgentAdapter } from "./adapters/types.js";

/**
 * Build adapters backed by the provider-supported interfaces shipped with
 * Loadout: Claude Code print-mode CLI and the OpenAI Codex SDK.
 */
export function createProviderAdapters(): AgentAdapter[] {
  const codex = new Codex();
  const codexDriver: CodexSdkDriver = {
    runtimeVersion: "Codex SDK (bundled)",
    startThread(options) {
      return codex.startThread(options);
    },
    resumeThread(sessionId, options) {
      return codex.resumeThread(sessionId, options);
    },
  };

  return [new ClaudeCodeAdapter(), new CodexAdapter(codexDriver)];
}
