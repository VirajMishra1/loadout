/**
 * Redact sensitive data from coordination event payloads.
 *
 * Applied on emit, before storage. Patterns match common secret formats
 * (API keys, tokens, passwords, GitHub PATs, Stripe keys, JWTs, etc.).
 */

const REDACTION_MARKER = "[REDACTED]";
const SENSITIVE_KEY =
  /^(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|secret|token|password|passwd|pwd|credentials?)$/i;

const SECRET_PATTERNS: RegExp[] = [
  // Key-value patterns: api_key=..., secret: "...", password='...'
  /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|credentials?)\s*[:=]\s*['"]?([^\s'"]{12,})['"]?/gi,
  // Stripe keys: sk_live_..., pk_test_..., rk_live_...
  /(?:sk|pk|rk)[-_](?:live|test)[-_][a-zA-Z0-9]{10,}/g,
  // GitHub PATs
  /ghp_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9_]{22,}/g,
  // OpenAI keys
  /sk-[a-zA-Z0-9]{20,}/g,
  // Anthropic keys
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  // AWS keys
  /AKIA[0-9A-Z]{16}/g,
  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9._\-/+=]{20,}/gi,
  // JWTs (three base64 segments separated by dots)
  /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  // Generic long hex/base64 strings that look like secrets (40+ chars)
  /(?:^|["'\s=:])([a-f0-9]{40,})(?:["'\s]|$)/gm,
  // .env style: ENV_VAR=value on its own line
  /^[A-Z][A-Z0-9_]{2,}_(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)\s*=\s*(.+)$/gm,
];

export function redactString(input: string): string {
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for stateful regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match) => {
      // Keep the key part, redact the value part
      const eqIndex = match.search(/[:=]\s*/);
      if (eqIndex !== -1) {
        return match.slice(0, eqIndex + 1) + " " + REDACTION_MARKER;
      }
      return REDACTION_MARKER;
    });
  }
  return result;
}

export function redactPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEY.test(key) && typeof value === "string") {
      result[key] = REDACTION_MARKER;
    } else if (typeof value === "string") {
      result[key] = redactString(value);
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = redactPayload(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? redactString(item)
          : item !== null && typeof item === "object"
            ? redactPayload(item as Record<string, unknown>)
            : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function redactDescription(description: string): string {
  return redactString(description);
}

export function redactCoordinationInput<
  T extends {
    description: string;
    context?: string;
    payload?: Record<string, unknown>;
  },
>(input: T): T {
  return {
    ...input,
    description: redactString(input.description),
    ...(input.context ? { context: redactString(input.context) } : {}),
    ...(input.payload ? { payload: redactPayload(input.payload) } : {}),
  };
}
