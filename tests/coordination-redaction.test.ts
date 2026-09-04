import { describe, it, expect } from "vitest";
import {
  redactString,
  redactPayload,
  redactDescription,
} from "../src/core/coordination/redaction.js";

describe("redactString", () => {
  it("redacts API key patterns", () => {
    expect(redactString("api_key=sk_live_abc123xyz789000")).toContain(
      "[REDACTED]",
    );
    expect(redactString('apiKey: "mySecretKey12345678"')).toContain(
      "[REDACTED]",
    );
  });

  it("redacts GitHub PATs", () => {
    expect(
      redactString("token ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1234"),
    ).toContain("[REDACTED]");
  });

  it("redacts Stripe keys", () => {
    expect(redactString("sk_live_abcdefghijklmnopqrstuv")).toContain(
      "[REDACTED]",
    );
    expect(redactString("pk_test_abcdefghijklmnopqrstuv")).toContain(
      "[REDACTED]",
    );
  });

  it("redacts Bearer tokens", () => {
    expect(
      redactString("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c.rest"),
    ).toContain("[REDACTED]");
  });

  it("redacts OpenAI keys", () => {
    expect(redactString("sk-abcdefghijklmnopqrstuvwxyz")).toContain(
      "[REDACTED]",
    );
  });

  it("redacts AWS access keys", () => {
    expect(redactString("AKIAIOSFODNN7EXAMPLE0")).toContain("[REDACTED]");
  });

  it("leaves normal text alone", () => {
    const normal = "Implemented auth endpoint for user login";
    expect(redactString(normal)).toBe(normal);
  });

  it("leaves short tokens alone", () => {
    const short = "token: abc";
    // Too short to match the 8+ char threshold
    expect(redactString(short)).toBe(short);
  });
});

describe("redactPayload", () => {
  it("redacts nested string values", () => {
    const payload = {
      name: "auth-api",
      body: 'const API_KEY = "sk_live_abcdefghijklmnopqrstuv"',
      revision: 1,
    };
    const result = redactPayload(payload);
    expect(result.name).toBe("auth-api");
    expect(result.body).toContain("[REDACTED]");
    expect(result.revision).toBe(1);
  });

  it("redacts arrays of strings", () => {
    const payload = {
      files: ["src/auth.ts", "password=supersecretpassword123"],
    };
    const result = redactPayload(payload);
    expect((result.files as string[])[0]).toBe("src/auth.ts");
    expect((result.files as string[])[1]).toContain("[REDACTED]");
  });

  it("redacts deeply nested objects with key=value strings", () => {
    const payload = {
      config: {
        auth: {
          env: "secret=mysupersecretvalue123456",
        },
      },
    };
    const result = redactPayload(payload);
    expect(
      (result.config as Record<string, Record<string, string>>).auth.env,
    ).toContain("[REDACTED]");
  });
});

describe("redactDescription", () => {
  it("redacts secrets in descriptions", () => {
    const desc =
      "Set API_KEY_SECRET=sk_live_abcdefghijklmnopqrstuv for production";
    expect(redactDescription(desc)).toContain("[REDACTED]");
  });

  it("leaves normal descriptions alone", () => {
    const desc = "Published auth-api rev3 with JWT support";
    expect(redactDescription(desc)).toBe(desc);
  });
});
