import { describe, expect, it } from "vitest";
import {
  parseProviderModelConfiguration,
  requestOpenRouter,
} from "../src/core/model-config.js";

describe("provider-neutral model configuration", () => {
  it("accepts a secret-free OpenRouter selection without implementing an adapter", () => {
    const config = parseProviderModelConfiguration({
      schemaVersion: 1,
      selections: [
        {
          id: "coding",
          provider: "openrouter",
          model: "anthropic/claude-sonnet-4",
          endpoint: "https://openrouter.ai/api/v1",
          credential: { kind: "environment", name: "OPENROUTER_API_KEY" },
          targetAgents: ["codex", "claude-code"],
        },
      ],
    });
    expect(config.selections[0]).toMatchObject({
      provider: "openrouter",
      credential: { kind: "environment", name: "OPENROUTER_API_KEY" },
    });
    expect(JSON.stringify(config)).not.toContain("sk-or-");
  });

  it("rejects raw keys, secret-like model values, headers, and invalid references", () => {
    const selection = {
      id: "coding",
      provider: "openrouter",
      model: "openai/gpt-5",
      endpoint: "https://openrouter.ai/api/v1",
    };
    expect(() =>
      parseProviderModelConfiguration({
        schemaVersion: 1,
        selections: [{ ...selection, apiKey: "sk-or-v1-a-raw-secret-value" }],
      }),
    ).toThrow(/apiKey/);
    expect(() =>
      parseProviderModelConfiguration({
        schemaVersion: 1,
        selections: [{ ...selection, model: "sk-or-v1-a-raw-secret-value" }],
      }),
    ).toThrow(/credential value/);
    expect(() =>
      parseProviderModelConfiguration({
        schemaVersion: 1,
        selections: [
          { ...selection, headers: { Authorization: "Bearer secret" } },
        ],
      }),
    ).toThrow(/headers/);
    expect(() =>
      parseProviderModelConfiguration({
        schemaVersion: 1,
        selections: [
          {
            ...selection,
            credential: {
              kind: "environment",
              name: "sk-or-v1-a-raw-secret-value",
            },
          },
        ],
      }),
    ).toThrow(/environment variable name/);
  });

  it("requires secure endpoints and unique selection ids", () => {
    const base = {
      id: "coding",
      provider: "openrouter",
      model: "openai/gpt-5",
      endpoint: "https://openrouter.ai/api/v1",
    };
    expect(() =>
      parseProviderModelConfiguration({
        schemaVersion: 1,
        selections: [{ ...base, endpoint: "http://openrouter.ai/api/v1" }],
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      parseProviderModelConfiguration({
        schemaVersion: 1,
        selections: [base, { ...base, model: "anthropic/claude-sonnet-4" }],
      }),
    ).toThrow(/unique/);
  });

  it("resolves a credential only for the outbound OpenRouter request", async () => {
    const config = parseProviderModelConfiguration({
      schemaVersion: 1,
      selections: [
        {
          id: "coding",
          provider: "openrouter",
          model: "openai/gpt-5",
          endpoint: "https://openrouter.ai/api/v1",
          credential: { kind: "environment", name: "OPENROUTER_API_KEY" },
        },
      ],
    });
    let request: Request | undefined;
    const result = await requestOpenRouter(
      config,
      "coding",
      [{ role: "user", content: "hello" }],
      {
        resolveCredential: async () => "ephemeral-secret",
        fetcher: async (input, init) => {
          request = new Request(input, init);
          return new Response(JSON.stringify({ choices: [] }), { status: 200 });
        },
      },
    );
    expect(result).toEqual({ choices: [] });
    expect(request?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request?.headers.get("authorization")).toBe(
      "Bearer ephemeral-secret",
    );
    expect(JSON.stringify(config)).not.toContain("ephemeral-secret");
  });
});
