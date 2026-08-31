import { Command } from "commander";
import { loadEffectiveCatalog } from "../core/catalog.js";
import { parseAgentSelection } from "../core/paths.js";
import { resolve } from "node:path";

import {
  addManifestPackage,
  initManifest,
  readManifest,
  removeManifestPackage,
  writeLockfile,
} from "../core/manifest.js";
import { readInstallState } from "../core/state.js";

import { createPackage, searchLocalRegistry } from "../core/registry.js";
import { auditLoadout, formatAuditReport } from "../core/audit.js";

import {
  applyPortableImport,
  exportPortableLoadout,
  planPortableImport,
} from "../core/portable.js";

import { writeFileAtomically } from "../core/atomic-file.js";

import {
  buildLibraryStateReport,
  formatLibrarySummary,
  formatLibraryStateReport,
} from "../core/active-set.js";

import {
  buildPrivacySafeReport,
  formatPrivacySafeReport,
  writePrivacySafeReport,
} from "../core/share-report.js";

import { buildLoadoutCard, formatLoadoutCard } from "../core/loadout-card.js";

export function registerSharing(program: Command): void {
  program
    .command("init")
    .description("Create a shareable loadout.json manifest")
    .option("--path <path>", "manifest path", "loadout.json")
    .option("--name <name>", "Loadout name")
    .option("--agents <ids>", "comma-separated agent ids", "codex,claude-code")
    .option("--scope <scope>", "project or global", "project")
    .action(
      async (options: {
        path: string;
        name?: string;
        agents: string;
        scope: string;
      }) => {
        const manifest = await initManifest(options.path, {
          name: options.name,
          agents: parseAgentSelection(options.agents)!,
          scope: options.scope as "project" | "global",
        });
        console.log(
          `Created ${options.path} for ${manifest.agents.join(", ")}.`,
        );
      },
    );

  program
    .command("lock")
    .description("Write exact installed state to loadout.lock")
    .option("--manifest <path>", "manifest path", "loadout.json")
    .option("--output <path>", "lockfile path", "loadout.lock")
    .action(async (options: { manifest: string; output: string }) => {
      const lockfile = await writeLockfile(
        await readManifest(options.manifest),
        options.output,
      );
      console.log(
        `Wrote ${options.output} with ${lockfile.packages.length} resolved package(s).`,
      );
    });

  program
    .command("export")
    .description("Export a portable Loadout manifest and optional lockfile")
    .argument("<output>", "new portable JSON file")
    .option("--manifest <path>", "manifest path", "loadout.json")
    .option("--lock <path>", "include this exact lockfile")
    .action(
      async (output: string, options: { manifest: string; lock?: string }) => {
        const bundle = await exportPortableLoadout(
          options.manifest,
          output,
          options.lock,
        );
        console.log(
          `Exported ${bundle.manifest.packages.length} package(s) to ${output}.${bundle.lockfile ? " Exact lockfile included." : ""}`,
        );
      },
    );

  program
    .command("import")
    .description("Preview or apply a portable Loadout manifest and lockfile")
    .argument("<source>", "portable JSON file")
    .option("--manifest <path>", "manifest destination", "loadout.json")
    .option("--lock <path>", "lockfile destination", "loadout.lock")
    .option("--yes", "apply the import; otherwise remain read-only")
    .option(
      "--overwrite",
      "replace existing destination files after snapshotting them",
    )
    .action(
      async (
        source: string,
        options: {
          manifest: string;
          lock: string;
          yes?: boolean;
          overwrite?: boolean;
        },
      ) => {
        const preview = await planPortableImport(
          source,
          options.manifest,
          options.lock,
        );
        console.log(JSON.stringify(preview.plan, null, 2));
        if (!options.yes)
          return console.log(
            "Dry run only. Re-run with --yes to import this Loadout.",
          );
        const result = await applyPortableImport(
          source,
          options.manifest,
          options.lock,
          { overwrite: options.overwrite },
        );
        console.log(
          `Imported successfully. Recovery snapshot: ${result.snapshotId}.`,
        );
      },
    );

  program
    .command("audit")
    .description(
      "Verify manifest, lockfile, installed state, and managed file hashes for CI",
    )
    .option("--manifest <path>", "manifest path", "loadout.json")
    .option("--lock <path>", "lockfile path", "loadout.lock")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (options: { manifest: string; lock: string; json?: boolean }) => {
        const report = await auditLoadout(options.manifest, options.lock);
        console.log(
          options.json
            ? JSON.stringify(report, null, 2)
            : formatAuditReport(report),
        );
        if (!report.valid) process.exitCode = 1;
      },
    );

  program
    .command("create")
    .description("Create a new Loadout package directory")
    .argument("<directory>", "new package directory")
    .requiredOption("--name <name>", "lowercase package name")
    .option("--description <text>", "package description")
    .option("--version <version>", "semantic version", "0.1.0")
    .action(
      async (
        directory: string,
        options: { name: string; description?: string; version: string },
      ) => {
        const descriptor = await createPackage(directory, options);
        console.log(
          `Created ${descriptor.name}@${descriptor.version} in ${directory}.`,
        );
      },
    );

  program
    .command("search")
    .description("Search the bundled catalog and local registry")
    .argument("[query]", "search text", "")
    .option("--json", "emit machine-readable JSON")
    .action(async (query: string, options: { json?: boolean }) => {
      const catalog = (await loadEffectiveCatalog())
        .filter(
          (pkg) =>
            !query ||
            `${pkg.id} ${pkg.displayName} ${pkg.description}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .map((pkg) => ({
          source: "catalog",
          name: pkg.id,
          description: pkg.description,
          repository: pkg.repository,
        }));
      const local = (await searchLocalRegistry(query)).map((pkg) => ({
        source: "registry",
        ...pkg,
      }));
      if (options.json)
        return console.log(JSON.stringify([...catalog, ...local], null, 2));
      for (const item of [...catalog, ...local])
        console.log(
          `${item.name}${"version" in item ? `@${item.version}` : ""} [${item.source}] — ${item.description}`,
        );
      if (!catalog.length && !local.length)
        console.log("No matching packages found.");
    });

  program
    .command("add")
    .description("Add a catalog, GitHub, or local package to loadout.json")
    .argument("<id>", "package id")
    .option("--manifest <path>", "manifest path", "loadout.json")
    .option("--catalog <id>", "catalog package id")
    .option("--repository <owner/repo>", "public GitHub repository")
    .option("--git <url>", "generic HTTPS or SSH Git repository")
    .option("--registry <name@version>", "exact local registry package version")
    .option(
      "--remote-registry <url>",
      "fetch --registry name@version from this remote registry",
    )
    .option("--ref <ref>", "Git branch, tag, or ref")
    .option("--path <path>", "GitHub repository subpath or local path")
    .option("--local", "treat --path as a local source")
    .option("--agents <ids>", "comma-separated target agents")
    .option("--depends-on <ids>", "comma-separated package dependencies")
    .action(
      async (
        id: string,
        options: {
          manifest: string;
          catalog?: string;
          repository?: string;
          git?: string;
          registry?: string;
          remoteRegistry?: string;
          ref?: string;
          path?: string;
          local?: boolean;
          agents?: string;
          dependsOn?: string;
        },
      ) => {
        const selected =
          Number(Boolean(options.catalog)) +
          Number(Boolean(options.repository)) +
          Number(Boolean(options.git)) +
          Number(Boolean(options.registry)) +
          Number(Boolean(options.local));
        if (selected !== 1)
          throw new Error(
            "Choose exactly one source: --catalog, --repository, --git, --registry, or --local with --path",
          );
        if (options.local && !options.path)
          throw new Error("--local requires --path <directory>");
        const registry = options.registry?.match(
          /^([a-z0-9][a-z0-9._-]*)@(.+)$/,
        );
        if (options.registry && !registry)
          throw new Error("--registry expects name@version");
        if (options.remoteRegistry && !registry)
          throw new Error("--remote-registry requires --registry name@version");
        const source = options.catalog
          ? { type: "catalog" as const, id: options.catalog }
          : options.repository
            ? {
                type: "github" as const,
                repository: options.repository,
                ...(options.ref ? { ref: options.ref } : {}),
                ...(options.path ? { path: options.path } : {}),
              }
            : options.git
              ? {
                  type: "git" as const,
                  url: options.git,
                  ...(options.ref ? { ref: options.ref } : {}),
                  ...(options.path ? { path: options.path } : {}),
                }
              : registry && options.remoteRegistry
                ? {
                    type: "remote-registry" as const,
                    registry: options.remoteRegistry,
                    name: registry[1],
                    version: registry[2],
                  }
                : registry
                  ? {
                      type: "registry" as const,
                      name: registry[1],
                      version: registry[2],
                    }
                  : { type: "local" as const, path: options.path! };
        const manifest = await addManifestPackage(options.manifest, {
          id,
          source,
          ...(options.agents
            ? { agents: parseAgentSelection(options.agents)! }
            : {}),
          ...(options.dependsOn
            ? { dependsOn: options.dependsOn.split(",") }
            : {}),
        });
        console.log(
          `Added ${id} to ${options.manifest}. ${manifest.packages.length} package(s) configured.`,
        );
      },
    );

  program
    .command("unadd")
    .description(
      "Remove a desired package from loadout.json without touching installed files",
    )
    .argument("<id>", "package id")
    .option("--manifest <path>", "manifest path", "loadout.json")
    .action(async (id: string, options: { manifest: string }) => {
      const manifest = await removeManifestPackage(options.manifest, id);
      console.log(
        `Removed ${id} from ${options.manifest}. ${manifest.packages.length} package(s) configured.`,
      );
    });

  program
    .command("list")
    .alias("ls")
    .description("List packages managed by Loadout")
    .option("--json", "emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const state = await readInstallState();
      if (options.json)
        return console.log(JSON.stringify(state.installs, null, 2));
      if (!state.installs.length)
        return console.log("No Loadout-managed packages are installed.");
      for (const item of state.installs)
        console.log(
          `${item.packageId} — ${item.targetAgents.join(", ")} — ${item.resolvedCommit?.slice(0, 12) ?? "local"} — ${item.files.length} file(s)`,
        );
    });

  program
    .command("library")
    .description(
      "Show separate cache, review, installation, and per-agent activation state",
    )
    .option("--json", "emit machine-readable JSON")
    .option("--all", "show every managed skill and its source package")
    .action(async (options: { json?: boolean; all?: boolean }) => {
      const report = await buildLibraryStateReport();
      console.log(
        options.json
          ? JSON.stringify(report, null, 2)
          : options.all
            ? formatLibraryStateReport(report)
            : formatLibrarySummary(report),
      );
    });

  program
    .command("report")
    .description(
      "Print a privacy-safe shareable summary without paths, code, prompts, or secrets",
    )
    .option("--json", "emit the machine-readable artifact")
    .action(async (options: { json?: boolean }) => {
      const report = await buildPrivacySafeReport();
      console.log(
        options.json
          ? JSON.stringify(report, null, 2)
          : formatPrivacySafeReport(report),
      );
    });

  program
    .command("share")
    .description("Write the privacy-safe Loadout report to a JSON artifact")
    .argument("<output>", "new or replacement report path")
    .action(async (output: string) => {
      const report = await buildPrivacySafeReport();
      await writePrivacySafeReport(output, report);
      console.log(
        `Wrote privacy-safe Loadout report to ${output}. Review it before sharing.`,
      );
    });

  program
    .command("card")
    .description(
      "Render a privacy-safe Markdown evidence card without project or repository details",
    )
    .option("--output <path>", "write the Markdown card to a file")
    .option("--json", "emit the underlying privacy-safe card as JSON")
    .action(async (options: { output?: string; json?: boolean }) => {
      if (options.output && options.json)
        throw new Error("--output and --json cannot be used together");
      const card = await buildLoadoutCard();
      const markdown = formatLoadoutCard(card);
      if (options.output) {
        await writeFileAtomically(resolve(options.output), `${markdown}\n`);
        console.log(
          `Wrote privacy-safe Loadout card to ${resolve(options.output)}. Review it before sharing.`,
        );
        return;
      }
      console.log(options.json ? JSON.stringify(card, null, 2) : markdown);
    });
}
