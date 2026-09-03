import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  loadEffectiveCatalog,
  promoteCatalogCandidate,
  validateCatalog,
} from "../core/catalog/catalog.js";
import {
  buildCandidateDossier,
  buildCatalogProposal,
  formatCandidateDossier,
  formatCandidateSummaries,
  listDiscoveryCandidates,
  readCandidateDossier,
  verifyCandidateDossierSource,
  writeCandidateDossier,
} from "../core/discovery/candidate-intelligence.js";
import { markPromoted } from "../core/discovery/review-queue.js";
import { writeFileAtomically } from "../core/install/atomic-file.js";
import type {
  CatalogPackage,
  OperatingSystem,
  PackageTier,
} from "../shared/types.js";

export function registerCandidateCommands(program: Command): void {
  const candidate = program
    .command("candidate")
    .description(
      "Triage and statically inspect daily discovery candidates; never auto-promotes",
    );

  candidate
    .command("list")
    .allowExcessArguments(false)
    .description(
      "Rank discovery leads for human triage, not as universal quality",
    )
    .option("--limit <count>", "maximum candidates", "20")
    .option("--query <words>", "require all search words")
    .option("--include-reviewed", "include repositories already in the catalog")
    .option("--feed <path>", "alternate discovered.json evidence feed")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (options: {
        limit: string;
        query?: string;
        includeReviewed?: boolean;
        feed?: string;
        json?: boolean;
      }) => {
        const limit = Number(options.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500)
          throw new Error("--limit must be an integer from 1 to 500");
        const result = await listDiscoveryCandidates({
          limit,
          query: options.query,
          includeReviewed: options.includeReviewed,
          path: options.feed,
        });
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : formatCandidateSummaries(result),
        );
      },
    );

  candidate
    .command("inspect")
    .allowExcessArguments(false)
    .description(
      "Clone one lead at an immutable commit and build a static evidence dossier",
    )
    .argument("<repository>", "owner/repository present in the discovery feed")
    .option("--feed <path>", "alternate discovered.json evidence feed")
    .option("--write", "persist the dossier in private Loadout state")
    .option("--output <path>", "persist at an explicit path (implies --write)")
    .option("--json", "emit the complete dossier as JSON")
    .action(
      async (
        repository: string,
        options: {
          feed?: string;
          write?: boolean;
          output?: string;
          json?: boolean;
        },
      ) => {
        const dossier = await buildCandidateDossier(repository, {
          discoveryPath: options.feed,
        });
        const path =
          options.write || options.output
            ? await writeCandidateDossier(dossier, options.output)
            : undefined;
        if (options.json)
          return console.log(
            JSON.stringify(
              {
                dossier,
                persisted: Boolean(path),
                ...(path ? { path } : {}),
              },
              null,
              2,
            ),
          );
        console.log(formatCandidateDossier(dossier));
        if (path) console.log(`Dossier: ${path}`);
        else {
          console.log(
            "Preview only. Re-run with --write to persist this dossier.",
          );
        }
      },
    );

  candidate
    .command("propose")
    .allowExcessArguments(false)
    .description(
      "Convert a reviewed dossier into a catalog-record proposal; never edits the catalog",
    )
    .argument("<dossier>", "persisted candidate dossier JSON")
    .requiredOption("--id <id>", "lowercase kebab-case catalog id")
    .requiredOption("--category <category>", "inspected catalog category")
    .requiredOption(
      "--platforms <ids>",
      "explicitly reviewed comma-separated platforms: windows,macos,linux",
    )
    .option("--display-name <name>", "reviewed display name")
    .option("--description <text>", "reviewed description")
    .option("--license <spdx>", "human-reviewed license override")
    .option(
      "--tier <tier>",
      "official, stable, trending, or community",
      "community",
    )
    .option("--approve", "confirm human review and write the proposal")
    .option(
      "--output <path>",
      "proposal JSON output path; required with --approve",
    )
    .option("--json", "emit machine-readable JSON")
    .action(
      async (
        dossierPath: string,
        options: {
          id: string;
          category: string;
          platforms: string;
          displayName?: string;
          description?: string;
          license?: string;
          tier: string;
          approve?: boolean;
          output?: string;
          json?: boolean;
        },
      ) => {
        const platforms = options.platforms
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const knownPlatforms = new Set(["windows", "macos", "linux"]);
        if (platforms.some((item) => !knownPlatforms.has(item)))
          throw new Error(
            "--platforms supports only windows, macos, and linux",
          );
        const knownTiers = new Set([
          "official",
          "stable",
          "trending",
          "community",
        ]);
        if (!knownTiers.has(options.tier)) throw new Error("--tier is invalid");
        if (options.approve && !options.output)
          throw new Error(
            "--approve requires --output so catalog mutation stays separate",
          );
        const proposal = buildCatalogProposal(
          await verifyCandidateDossierSource(
            await readCandidateDossier(dossierPath),
          ),
          {
            id: options.id,
            category: options.category,
            operatingSystems: platforms as OperatingSystem[],
            tier: options.tier as PackageTier,
            displayName: options.displayName,
            description: options.description,
            license: options.license,
          },
          await loadEffectiveCatalog(),
        );
        const output = options.approve ? resolve(options.output!) : undefined;
        if (output)
          await writeFileAtomically(
            output,
            `${JSON.stringify(proposal, null, 2)}\n`,
          );
        if (options.json)
          return console.log(
            JSON.stringify(
              {
                proposal,
                approved: Boolean(output),
                catalogMutated: false,
                ...(output ? { output } : {}),
              },
              null,
              2,
            ),
          );
        console.log(JSON.stringify(proposal, null, 2));
        if (!output)
          console.log(
            "Proposal preview only. Human review is still required; use --approve --output <path> to persist it.",
          );
        else console.log(`Approved proposal written to ${output}.`);
      },
    );

  candidate
    .command("promote")
    .allowExcessArguments(false)
    .description(
      "Merge a reviewed proposal into the local catalog; requires --approve",
    )
    .argument(
      "<proposal>",
      "proposal JSON file from `candidate propose --approve`",
    )
    .option("--approve", "confirm human review and write to catalog")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (
        proposalPath: string,
        options: { approve?: boolean; json?: boolean },
      ) => {
        const proposal: CatalogPackage = JSON.parse(
          await readFile(resolve(proposalPath), "utf8"),
        );
        validateCatalog([proposal], { requireEvidence: true });
        if (!options.approve) {
          if (options.json)
            return console.log(
              JSON.stringify(
                { proposal, promoted: false, catalogMutated: false },
                null,
                2,
              ),
            );
          console.log(JSON.stringify(proposal, null, 2));
          console.log(
            "Preview only. Re-run with --approve to merge into the catalog.",
          );
          return;
        }
        const result = await promoteCatalogCandidate(proposal);
        const item = await markPromoted(proposal.repository);
        if (options.json)
          return console.log(
            JSON.stringify(
              {
                proposal,
                promoted: true,
                catalogMutated: true,
                ...result,
                reviewQueue: item,
              },
              null,
              2,
            ),
          );
        console.log(
          `Promoted '${proposal.id}' into ${result.catalogPath} (${result.totalRecords} records). Review queue: ${item.repository} marked promoted.`,
        );
      },
    );
}
