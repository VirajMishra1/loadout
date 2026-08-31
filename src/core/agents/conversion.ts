import { basename } from "node:path";

export type ConversionKind = "subagent" | "hook";
export type ConversionTarget = "codex-skill" | "claude-skill" | "static-review";

export interface ConversionInput {
  kind: ConversionKind;
  name: string;
  body: string;
  metadata?: Record<string, string>;
}

export interface ConversionResult {
  source: ConversionKind;
  target: ConversionTarget;
  content: string;
  relativePath: string;
  preserved: string[];
  dropped: Array<{ field: string; reason: string }>;
  requiresApproval: boolean;
}

function safeName(name: string): string {
  const value = basename(name).replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!value) throw new Error("Conversion name must contain a safe identifier");
  return value.toLowerCase();
}

/**
 * Compile only static instruction semantics. Hooks never become executable
 * hooks; their trigger and command are preserved in a review artifact.
 */
export function compileConversion(
  input: ConversionInput,
  target: ConversionTarget,
): ConversionResult {
  const name = safeName(input.name);
  if (!input.body.trim()) throw new Error("Conversion source body is empty");
  if (input.kind === "hook" && target !== "static-review")
    throw new Error(
      "Hooks may only convert to static-review; executable behavior is never synthesized",
    );
  if (input.kind === "subagent" && target === "static-review")
    throw new Error("Subagents require a skill target for static conversion");
  if (target === "static-review") {
    return {
      source: input.kind,
      target,
      relativePath: `conversion-reports/${name}.md`,
      content: `# Hook conversion review: ${name}\n\nThe original hook was not executed or converted into an executable hook.\n\n## Source instructions\n\n${input.body.trim()}\n`,
      preserved: ["instruction text", "source name"],
      dropped: [
        {
          field: "trigger and command execution",
          reason: "hooks are not portable and must be reviewed manually",
        },
      ],
      requiresApproval: true,
    };
  }
  const dropped = [
    {
      field: "agent runtime metadata",
      reason: "target agent may not support the source model/tools contract",
    },
  ];
  for (const field of Object.keys(input.metadata ?? {}))
    dropped.push({
      field,
      reason: "metadata is not part of the portable instruction body",
    });
  return {
    source: input.kind,
    target,
    relativePath: `skills/${name}/SKILL.md`,
    content: `---\nname: ${name}\ndescription: Converted static instructions; review before use\n---\n\n${input.body.trim()}\n`,
    preserved: ["instruction text", "source name"],
    dropped,
    requiresApproval: true,
  };
}
