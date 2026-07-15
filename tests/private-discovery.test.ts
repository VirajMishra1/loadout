import { describe, expect, it } from "vitest";
import { discoverPrivateRepositories } from "../src/core/private-discovery.js";

describe("opt-in private repository discovery", () => {
  it("requires an explicit credential and never returns it", async () => {
    await expect(
      discoverPrivateRepositories({ fetcher: async () => new Response("[]") }),
    ).rejects.toThrow(/requires an explicit GITHUB_TOKEN/);
  });

  it("returns private repository metadata through an injected request", async () => {
    let authorization = "";
    const result = await discoverPrivateRepositories({
      token: "ephemeral-token",
      fetcher: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(
          JSON.stringify([
            {
              id: 3,
              full_name: "acme/private-app",
              private: true,
              default_branch: "main",
              updated_at: "2026-07-15T00:00:00Z",
              topics: ["agent"],
            },
            { id: 4, full_name: "acme/public", private: false },
          ]),
        );
      },
    });
    expect(result).toEqual([
      expect.objectContaining({ repository: "acme/private-app" }),
    ]);
    expect(authorization).toBe("Bearer ephemeral-token");
    expect(JSON.stringify(result)).not.toContain("ephemeral-token");
  });
});
