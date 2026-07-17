import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ADAPTER_CAPABILITIES } from "../src/core/adapters.js";
import { loadCatalog } from "../src/core/catalog.js";
import { deriveReadmeFacts } from "../src/core/readme-facts.js";
import {
  POWER_SKILL_ALLOWLIST,
  STABLE_SKILL_ALLOWLIST,
} from "../src/core/profiles.js";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  name: string;
  version: string;
  bin: Record<string, string>;
  engines: { node: string };
};

describe("README facts", () => {
  it("derives catalog facts without duplicated README constants", async () => {
    const catalog = await loadCatalog();
    const facts = deriveReadmeFacts({
      catalog,
      packageJson,
      agents: ADAPTER_CAPABILITIES,
      profiles: {
        stable: STABLE_SKILL_ALLOWLIST,
        power: POWER_SKILL_ALLOWLIST,
      },
    });

    expect(facts.catalog.records).toBe(catalog.length);
    expect(facts.catalog.noAssertionLicenses).toBe(
      catalog.filter((item) => item.license === "NOASSERTION").length,
    );
    expect(facts.catalog.components.skill).toBe(
      catalog.filter((item) => item.components?.includes("skill")).length,
    );
    expect(facts.runtime.node).toBe(packageJson.engines.node);
  });

  it("derives the checked-in catalog, profile, adapter, and package facts", async () => {
    const facts = deriveReadmeFacts({
      catalog: await loadCatalog(),
      packageJson,
      agents: ADAPTER_CAPABILITIES,
      profiles: {
        stable: STABLE_SKILL_ALLOWLIST,
        power: POWER_SKILL_ALLOWLIST,
      },
    });

    expect(facts.catalog).toMatchObject({
      records: 50,
      categories: 37,
      components: { skill: 31 },
      installShapes: { mcpOnly: 19 },
      noAssertionLicenses: 6,
    });
    expect(facts.profiles.stable).toEqual({
      sources: 4,
      skillDirectories: 30,
    });
    expect(facts.agents.supportedNames).toEqual(
      ADAPTER_CAPABILITIES.map((agent) => agent.displayName),
    );
    expect(facts.package).toEqual({
      name: "loadout-ai",
      version: packageJson.version,
      bin: packageJson.bin,
    });
    expect(facts.runtime).toEqual({ node: ">=20" });
  });
});
