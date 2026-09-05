import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyTemplate,
  BUILTIN_TEMPLATES,
  deleteTemplate,
  formatTemplateDetail,
  formatTemplateList,
  listTemplates,
  loadTemplate,
  saveTemplate,
  type HandoffTemplate,
} from "../src/core/delegation/handoff-templates.js";

describe("handoff templates", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(
      join(tmpdir(), "loadout-handoff-templates-test-"),
    );
  });

  it("lists built-in templates when no custom ones exist", async () => {
    const result = await listTemplates(projectRoot);
    expect(result.custom).toEqual([]);
    expect(result.builtin.length).toBe(BUILTIN_TEMPLATES.length);
    expect(result.builtin.map((t) => t.name)).toContain("write-tests");
    expect(result.builtin.map((t) => t.name)).toContain("fix-bug");
  });

  it("saves and loads a custom template", async () => {
    const tmpl: HandoffTemplate = {
      name: "deploy-staging",
      description: "Deploy to staging and verify",
      defaultAgent: "codex",
      taskTemplate: "Deploy {{branch}} to staging",
      verifyCriteria: "Staging URL returns 200",
    };

    await saveTemplate(projectRoot, tmpl);
    const loaded = await loadTemplate(projectRoot, "deploy-staging");
    expect(loaded).toMatchObject(tmpl);
  });

  it("custom templates override builtins with same name", async () => {
    const custom: HandoffTemplate = {
      name: "write-tests",
      description: "Custom test writing template",
      verifyCriteria: "Custom criteria",
    };

    await saveTemplate(projectRoot, custom);
    const loaded = await loadTemplate(projectRoot, "write-tests");
    expect(loaded!.description).toBe("Custom test writing template");

    const all = await listTemplates(projectRoot);
    expect(all.custom.map((t) => t.name)).toContain("write-tests");
    expect(all.builtin.map((t) => t.name)).not.toContain("write-tests");
  });

  it("loads a built-in template by name", async () => {
    const tmpl = await loadTemplate(projectRoot, "write-tests");
    expect(tmpl).toBeDefined();
    expect(tmpl!.name).toBe("write-tests");
    expect(tmpl!.verifyCriteria).toBeDefined();
  });

  it("returns null for nonexistent template", async () => {
    const tmpl = await loadTemplate(projectRoot, "nonexistent");
    expect(tmpl).toBeNull();
  });

  it("deletes a custom template", async () => {
    await saveTemplate(projectRoot, {
      name: "temp",
      description: "temporary",
    });
    expect(await loadTemplate(projectRoot, "temp")).not.toBeNull();

    const deleted = await deleteTemplate(projectRoot, "temp");
    expect(deleted).toBe(true);

    // Still accessible as a custom template? No.
    const files = await readdir(join(projectRoot, ".handoff", "templates"));
    expect(files).not.toContain("temp.json");
  });

  it("delete returns false for nonexistent template", async () => {
    const deleted = await deleteTemplate(projectRoot, "nonexistent");
    expect(deleted).toBe(false);
  });

  it("rejects traversal names before deleting template files", async () => {
    const packagePath = join(projectRoot, "package.json");
    await writeFile(packagePath, '{"private":true}\n');

    await expect(
      deleteTemplate(projectRoot, "../../package"),
    ).rejects.toThrow(/template name/i);
    expect(await readFile(packagePath, "utf8")).toBe('{"private":true}\n');
  });

  it("applies template with placeholder substitution", () => {
    const tmpl: HandoffTemplate = {
      name: "write-tests",
      description: "Write tests",
      taskTemplate: "Write tests for {{files}}",
      context: "Follow existing patterns",
      verifyCriteria: "All tests pass",
      verifyCommand: {
        executable: "npm",
        args: ["test"],
        timeoutMs: 60_000,
      },
    };

    const applied = applyTemplate(tmpl, {
      vars: { files: "src/auth.ts" },
    });

    expect(applied.description).toBe("Write tests for src/auth.ts");
    expect(applied.context).toBe("Follow existing patterns");
    expect(applied.verifyCriteria).toBe("All tests pass");
    expect(applied.verifyCommand).toMatchObject({
      executable: "npm",
      args: ["test"],
      timeoutMs: 60_000,
    });
  });

  it("task override takes precedence over template", () => {
    const tmpl: HandoffTemplate = {
      name: "write-tests",
      description: "Write tests",
      taskTemplate: "Write tests for {{files}}",
    };

    const applied = applyTemplate(tmpl, {
      task: "Write integration tests for the API",
    });

    expect(applied.description).toBe("Write integration tests for the API");
  });

  it("binds positional input to common template placeholders", () => {
    const tmpl = BUILTIN_TEMPLATES.find((item) => item.name === "write-tests")!;
    expect(applyTemplate(tmpl, { input: "src/auth.ts" }).description).toBe(
      "Write tests for src/auth.ts",
    );
  });

  it("agent override takes precedence over template default", () => {
    const tmpl: HandoffTemplate = {
      name: "deploy",
      description: "Deploy",
      defaultAgent: "codex",
    };

    const applied = applyTemplate(tmpl, { agent: "claude-code" });
    expect(applied.agent).toBe("claude-code");
  });

  it("validates template name is kebab-case", async () => {
    await expect(
      saveTemplate(projectRoot, {
        name: "Bad Name",
        description: "invalid",
      }),
    ).rejects.toThrow();

    await expect(
      saveTemplate(projectRoot, {
        name: "CamelCase",
        description: "invalid",
      }),
    ).rejects.toThrow();
  });

  it("formats template list", async () => {
    await saveTemplate(projectRoot, {
      name: "custom-one",
      description: "A custom template",
    });

    const templates = await listTemplates(projectRoot);
    const output = formatTemplateList(templates);
    expect(output).toContain("custom-one");
    expect(output).toContain("A custom template");
    expect(output).toContain("Built-in templates");
  });

  it("formats template detail", () => {
    const tmpl: HandoffTemplate = {
      name: "deploy",
      description: "Deploy to staging",
      defaultAgent: "codex",
      verifyCriteria: "Returns 200",
      verifyCommand: {
        executable: "curl",
        args: ["-f", "https://staging.example.com"],
        timeoutMs: 30_000,
      },
    };

    const output = formatTemplateDetail(tmpl);
    expect(output).toContain("deploy");
    expect(output).toContain("codex");
    expect(output).toContain("Returns 200");
    expect(output).toContain("curl");
  });

  it("persists template as JSON file", async () => {
    await saveTemplate(projectRoot, {
      name: "my-template",
      description: "test persistence",
    });

    const raw = await readFile(
      join(projectRoot, ".handoff", "templates", "my-template.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe("my-template");
    expect(parsed.description).toBe("test persistence");
  });
});
