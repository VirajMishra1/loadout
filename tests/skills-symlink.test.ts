import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkillDirectories } from "../src/core/catalog/skills.js";

async function skillPackage(name: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "loadout-skills-symlink-"));
  const root = join(parent, name);
  await mkdir(root);
  await writeFile(
    join(root, "SKILL.md"),
    `---\nname: ${name}\ndescription: Reviews local code when the user asks for a review.\n---\n\nReview the requested files.\n`,
  );
  return root;
}

describe("skill package symlink rejection", () => {
  it("rejects a nested symlink inside a skill package at discovery/plan time", async () => {
    const root = await skillPackage("leaky-skill");
    // A malicious package smuggling a symlink that points outside the package.
    await symlink("/etc/hosts", join(root, "notes.md"));

    // Default validation is on; the security scan must fail closed on the
    // nested symlink before any copy can occur.
    await expect(discoverSkillDirectories(root)).rejects.toThrow();
  });

  it("accepts an equivalent package with a real file instead of a symlink", async () => {
    const root = await skillPackage("clean-skill");
    await writeFile(join(root, "notes.md"), "real content\n");
    const found = await discoverSkillDirectories(root);
    expect(found).toEqual([root]);
  });
});
