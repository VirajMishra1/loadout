/**
 * Handoff templates — reusable task presets for common handoff patterns.
 *
 * Templates live in `.handoff/templates/` as JSON files. Each defines
 * default fields (verification, context, bundle globs) so agents can
 * hand off tasks with a single `--template <name>` flag.
 */

import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────

export interface HandoffTemplate {
  /** Template name (kebab-case, used as filename). */
  name: string;
  /** One-line description shown in listings. */
  description: string;
  /** Default receiver agent. */
  defaultAgent?: string;
  /** Task description template — {{placeholders}} get replaced. */
  taskTemplate?: string;
  /** Default context text. */
  context?: string;
  /** Default bundle file globs. */
  bundleGlobs?: string[];
  /** Default verification criteria. */
  verifyCriteria?: string;
  /** Default verification command. */
  verifyCommand?: {
    executable: string;
    args: string[];
    timeoutMs?: number;
  };
}

const templateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case"),
  description: z.string().trim().min(1),
  defaultAgent: z.string().trim().min(1).optional(),
  taskTemplate: z.string().trim().min(1).optional(),
  context: z.string().optional(),
  bundleGlobs: z.array(z.string().trim().min(1)).optional(),
  verifyCriteria: z.string().trim().min(1).optional(),
  verifyCommand: z
    .object({
      executable: z.string().trim().min(1),
      args: z.array(z.string()),
      timeoutMs: z.number().int().min(1000).max(900_000).optional(),
    })
    .optional(),
});

// ── Built-in templates ─────────────────────────────────────────────────

export const BUILTIN_TEMPLATES: HandoffTemplate[] = [
  {
    name: "write-tests",
    description: "Write tests for specified files",
    taskTemplate: "Write tests for {{files}}",
    verifyCriteria: "All new tests pass",
    verifyCommand: {
      executable: "npm",
      args: ["test"],
      timeoutMs: 120_000,
    },
  },
  {
    name: "review-code",
    description: "Review code changes for bugs and style",
    taskTemplate: "Review the changes in {{files}} for correctness and style",
    verifyCriteria: "Review comments posted or no issues found",
  },
  {
    name: "fix-bug",
    description: "Fix a reported bug with verification",
    taskTemplate: "Fix: {{description}}",
    verifyCriteria: "Bug no longer reproduces and existing tests pass",
    verifyCommand: {
      executable: "npm",
      args: ["test"],
      timeoutMs: 120_000,
    },
  },
  {
    name: "implement-feature",
    description: "Implement a feature from spec",
    taskTemplate: "Implement: {{description}}",
    context: "Follow existing patterns in the codebase",
    verifyCriteria: "Feature works and tests pass",
    verifyCommand: {
      executable: "npm",
      args: ["test"],
      timeoutMs: 120_000,
    },
  },
  {
    name: "refactor",
    description: "Refactor code for clarity without behavior changes",
    taskTemplate: "Refactor {{files}} for clarity",
    verifyCriteria: "All existing tests still pass, no behavior changes",
    verifyCommand: {
      executable: "npm",
      args: ["test"],
      timeoutMs: 120_000,
    },
  },
];

// ── File I/O ───────────────────────────────────────────────────────────

const TEMPLATES_DIR = ".handoff/templates";

function templatesDir(projectRoot: string): string {
  return join(projectRoot, TEMPLATES_DIR);
}

function templatePath(projectRoot: string, name: string): string {
  return join(templatesDir(projectRoot), `${name}.json`);
}

export async function ensureTemplatesDir(projectRoot: string): Promise<void> {
  await mkdir(templatesDir(projectRoot), { recursive: true });
}

export async function saveTemplate(
  projectRoot: string,
  template: HandoffTemplate,
): Promise<void> {
  const parsed = templateSchema.parse(template);
  await ensureTemplatesDir(projectRoot);
  await writeFile(
    templatePath(projectRoot, parsed.name),
    JSON.stringify(parsed, null, 2) + "\n",
    "utf8",
  );
}

export async function deleteTemplate(
  projectRoot: string,
  name: string,
): Promise<boolean> {
  try {
    await unlink(templatePath(projectRoot, name));
    return true;
  } catch {
    return false;
  }
}

export async function loadTemplate(
  projectRoot: string,
  name: string,
): Promise<HandoffTemplate | null> {
  // Check custom templates first
  try {
    const raw = await readFile(templatePath(projectRoot, name), "utf8");
    return templateSchema.parse(JSON.parse(raw));
  } catch {
    // Fall through to builtins
  }

  return BUILTIN_TEMPLATES.find((t) => t.name === name) ?? null;
}

export async function listTemplates(
  projectRoot: string,
): Promise<{ custom: HandoffTemplate[]; builtin: HandoffTemplate[] }> {
  const custom: HandoffTemplate[] = [];

  try {
    const files = await readdir(templatesDir(projectRoot));
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(
          join(templatesDir(projectRoot), file),
          "utf8",
        );
        custom.push(templateSchema.parse(JSON.parse(raw)));
      } catch {
        // Skip malformed templates
      }
    }
  } catch {
    // No templates dir yet
  }

  // Filter builtins that have been overridden
  const customNames = new Set(custom.map((t) => t.name));
  const builtin = BUILTIN_TEMPLATES.filter((t) => !customNames.has(t.name));

  return { custom, builtin };
}

// ── Template application ───────────────────────────────────────────────

export interface ApplyTemplateOptions {
  /** Override the task description. */
  task?: string;
  /** Variables to fill into taskTemplate placeholders. */
  vars?: Record<string, string>;
  /** Override the default agent. */
  agent?: string;
}

export interface AppliedTemplate {
  agent?: string;
  description: string;
  context?: string;
  bundleGlobs?: string[];
  verifyCriteria?: string;
  verifyCommand?: {
    executable: string;
    args: string[];
    timeoutMs: number;
  };
}

export function applyTemplate(
  template: HandoffTemplate,
  options: ApplyTemplateOptions = {},
): AppliedTemplate {
  const vars = options.vars ?? {};

  // Resolve task description
  let description = options.task ?? template.taskTemplate ?? template.name;
  for (const [key, value] of Object.entries(vars)) {
    description = description.replaceAll(`{{${key}}}`, value);
  }

  return {
    agent: options.agent ?? template.defaultAgent,
    description,
    context: template.context,
    bundleGlobs: template.bundleGlobs,
    verifyCriteria: template.verifyCriteria,
    verifyCommand: template.verifyCommand
      ? {
          executable: template.verifyCommand.executable,
          args: template.verifyCommand.args,
          timeoutMs: template.verifyCommand.timeoutMs ?? 120_000,
        }
      : undefined,
  };
}

// ── Formatting ─────────────────────────────────────────────────────────

export function formatTemplateList(templates: {
  custom: HandoffTemplate[];
  builtin: HandoffTemplate[];
}): string {
  const lines: string[] = [];

  if (templates.custom.length === 0 && templates.builtin.length === 0) {
    return "No templates available.";
  }

  if (templates.custom.length) {
    lines.push(`\x1b[1mCustom templates\x1b[0m (${templates.custom.length})`);
    for (const t of templates.custom) {
      lines.push(`  \x1b[36m${t.name}\x1b[0m — ${t.description}`);
    }
  }

  if (templates.builtin.length) {
    if (templates.custom.length) lines.push("");
    lines.push(
      `\x1b[1mBuilt-in templates\x1b[0m (${templates.builtin.length})`,
    );
    for (const t of templates.builtin) {
      lines.push(`  \x1b[90m${t.name}\x1b[0m — ${t.description}`);
    }
  }

  lines.push("");
  lines.push(
    "\x1b[90mUse: loadout handoff <agent> --template <name> [task...]\x1b[0m",
  );
  lines.push(
    "\x1b[90mCreate: loadout template create <name> --description '...'\x1b[0m",
  );

  return lines.join("\n");
}

export function formatTemplateDetail(template: HandoffTemplate): string {
  const lines: string[] = [];
  lines.push(`\x1b[1m${template.name}\x1b[0m — ${template.description}`);

  if (template.defaultAgent) lines.push(`  Agent: ${template.defaultAgent}`);
  if (template.taskTemplate) lines.push(`  Task: ${template.taskTemplate}`);
  if (template.context) lines.push(`  Context: ${template.context}`);
  if (template.bundleGlobs)
    lines.push(`  Bundle: ${template.bundleGlobs.join(", ")}`);
  if (template.verifyCriteria)
    lines.push(`  Verify: ${template.verifyCriteria}`);
  if (template.verifyCommand) {
    lines.push(
      `  Command: ${template.verifyCommand.executable} ${template.verifyCommand.args.join(" ")}`,
    );
    if (template.verifyCommand.timeoutMs)
      lines.push(`  Timeout: ${template.verifyCommand.timeoutMs / 1000}s`);
  }

  return lines.join("\n");
}
