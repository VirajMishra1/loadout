import { Command } from "commander";
import {
  explainCatalogScore,
  loadEffectiveCatalog,
  loadCatalog,
  promoteCatalogCandidate,
  rankCatalog,
  refreshCatalog,
  validateCatalog,
} from "../core/catalog.js";
import { detectAgents, parseAgentSelection } from "../core/paths.js";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { CatalogPackage } from "../shared/types.js";
import {
  allPhaseRoutes,
  formatCostTable,
  formatModelCatalog,
  formatRouteRecommendation,
  formatRoutingTable,
  routePhase,
  routeTask,
  type TaskPhase,
} from "../core/route.js";
import {
  applyPickup,
  formatHandoffStatus,
  formatInbox,
  formatPickupPlan,
  getHandoffState,
  initHandoff,
  isHandoffInitialized,
  markDone,
  planPickup,
  readInbox,
  sendHandoff,
} from "../core/handoff.js";

import {
  catalogTrustStage,
  formatCatalogTrustStage,
} from "../core/profiles.js";
import { discoverHackerNewsRepositories } from "../core/community.js";
import { discoverPrivateRepositories } from "../core/private-discovery.js";
import {
  defaultGitHubDiscoveryQueries,
  discoverGitHubRepositories,
} from "../core/github-discovery.js";
import {
  formatStarHistory,
  readCatalogObservations,
} from "../core/observations.js";

import { writeFileAtomically } from "../core/atomic-file.js";

import {
  formatReviewQueue,
  markPromoted,
  mergeReviewQueue,
  readReviewQueue,
  setReviewDecision,
  type ReviewDecision,
  type ReviewQueueLead,
} from "../core/review-queue.js";
import {
  applyProviderModelSelection,
  defaultModelConfigurationPath,
  formatProviderModelConfiguration,
  planProviderModelSelection,
  readProviderModelConfiguration,
  requestOpenRouter,
} from "../core/model-config.js";

import {
  parseCompletionShell,
  renderShellCompletion,
} from "../core/completion.js";
import {
  buildCatalogCoverage,
  formatCatalogCoverage,
} from "../core/catalog-coverage.js";
import {
  createCredentialResolver,
  createOsCredentialStore,
} from "../core/credentials.js";
import {
  buildCandidateDossier,
  buildCatalogProposal,
  formatCandidateDossier,
  formatCandidateSummaries,
  listDiscoveryCandidates,
  readCandidateDossier,
  verifyCandidateDossierSource,
  writeCandidateDossier,
} from "../core/candidate-intelligence.js";
import type { OperatingSystem, PackageTier } from "../shared/types.js";

import { discoverSkillsSh } from "../core/skills-sh-discovery.js";
import { discoverOfficialMcpRegistry } from "../core/mcp-registry-discovery.js";

import { readCredentialFromStdin } from "./support.js";

export function registerCatalog(program: Command): void {
  program
    .command("catalog")
    .description("List the real package catalog")
    .option("--refresh", "fetch current GitHub stars and repository metadata")
    .option(
      "--explain <id>",
      "print the evidence and guardrails behind one package's ranking",
    )
    .option("--history <id>", "show locally recorded stars and release history")
    .option(
      "--coverage",
      "show capability, evidence, license, and overlap metrics",
    )
    .option("--json", "emit machine-readable output")
    .action(
      async (options: {
        refresh?: boolean;
        explain?: string;
        history?: string;
        coverage?: boolean;
        json?: boolean;
      }) => {
        if (
          [options.explain, options.history, options.coverage].filter(Boolean)
            .length > 1
        )
          throw new Error("Choose one of --explain, --history, or --coverage");
        const base = await loadCatalog();
        const result = options.refresh
          ? await refreshCatalog(base, { forceRefresh: true })
          : {
              catalog: await loadEffectiveCatalog(),
              failures: [],
              observationFailures: [],
            };
        if (options.history) {
          const pkg = result.catalog.find(
            (item) => item.id === options.history,
          );
          if (!pkg)
            throw new Error(`Unknown catalog package '${options.history}'`);
          console.log(
            formatStarHistory(await readCatalogObservations(pkg.repository)),
          );
          return;
        }
        if (options.explain) {
          const pkg = result.catalog.find(
            (item) => item.id === options.explain,
          );
          if (!pkg)
            throw new Error(`Unknown catalog package '${options.explain}'`);
          console.log(
            JSON.stringify(
              {
                package: {
                  id: pkg.id,
                  displayName: pkg.displayName,
                  category: pkg.category,
                  tier: pkg.tier,
                  trustStage: catalogTrustStage(pkg),
                  evidenceLabel: formatCatalogTrustStage(
                    catalogTrustStage(pkg),
                  ),
                },
                ranking: explainCatalogScore(pkg),
              },
              null,
              2,
            ),
          );
          return;
        }
        if (options.coverage) {
          const coverage = buildCatalogCoverage(result.catalog);
          console.log(
            options.json
              ? JSON.stringify(coverage, null, 2)
              : formatCatalogCoverage(coverage),
          );
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(rankCatalog(result.catalog), null, 2));
          return;
        }
        for (const pkg of rankCatalog(result.catalog)) {
          const topics = pkg.topics?.length
            ? ` — ${pkg.topics.join(", ")}`
            : "";
          const updated = pkg.lastUpdatedAt
            ? ` — updated ${pkg.lastUpdatedAt.slice(0, 10)}`
            : "";
          console.log(
            `${pkg.displayName} [${pkg.tier}; ${formatCatalogTrustStage(catalogTrustStage(pkg))}] ★${pkg.stars ?? "?"} — ${pkg.repository}${topics}${updated}`,
          );
        }
        for (const failure of result.failures)
          console.error(
            `Warning: could not refresh ${failure.repository}: ${failure.error}`,
          );
        for (const failure of result.observationFailures)
          console.error(
            `Warning: could not record release observation for ${failure.repository}: ${failure.error}`,
          );
      },
    );

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

  program
    .command("discover")
    .description(
      "Find public community leads; discovery never installs anything",
    )
    .option(
      "--source <source>",
      "source: github, hacker-news, skills-sh, mcp-registry, or all",
      "hacker-news",
    )
    .option("--limit <count>", "maximum source records or stories", "50")
    .option("--min-score <count>", "minimum Hacker News score", "20")
    .option(
      "--query <words>",
      "comma-separated words that must appear in a story (for example: codex,mcp,agent)",
    )
    .option(
      "--private",
      "opt into private GitHub metadata discovery using GITHUB_TOKEN",
    )
    .option(
      "--credential-keychain <service>",
      "resolve the private GitHub token from the OS credential store",
    )
    .option("--credential-account <account>", "OS credential account")
    .option(
      "--queue",
      "persist deduplicated public leads for human review; never promotes them",
    )
    .option("--json", "emit source evidence as JSON")
    .action(
      async (options: {
        source: string;
        limit: string;
        minScore: string;
        query?: string;
        private?: boolean;
        credentialKeychain?: string;
        credentialAccount?: string;
        queue?: boolean;
        json?: boolean;
      }) => {
        const limit = Number(options.limit);
        if (!Number.isInteger(limit) || limit < 1)
          throw new Error("--limit must be a positive integer");
        if (options.credentialKeychain && !options.private)
          throw new Error("--credential-keychain requires --private");
        if (options.private) {
          const token = options.credentialKeychain
            ? await createCredentialResolver()({
                kind: "os-keychain",
                service: options.credentialKeychain,
                ...(options.credentialAccount
                  ? { account: options.credentialAccount }
                  : {}),
              })
            : undefined;
          if (options.credentialKeychain && !token)
            throw new Error(
              "Private GitHub keychain credential did not resolve",
            );
          const repositories = await discoverPrivateRepositories({ token });
          if (options.json)
            return console.log(JSON.stringify(repositories, null, 2));
          console.log(`Private GitHub repositories: ${repositories.length}`);
          for (const repository of repositories)
            console.log(`${repository.repository} — ${repository.description}`);
          return;
        }
        if (options.source === "all") {
          const minScore = Number(options.minScore);
          if (!Number.isFinite(minScore) || minScore < 0)
            throw new Error("--min-score must be a non-negative number");
          const [github, hackerNews, skillsSh, mcpRegistry] =
            await Promise.allSettled([
              discoverGitHubRepositories({
                ...(options.query
                  ? { query: options.query }
                  : { queries: defaultGitHubDiscoveryQueries() }),
                limit,
              }),
              discoverHackerNewsRepositories({
                limit,
                minScore,
                keywords: options.query?.split(",") ?? [],
              }),
              discoverSkillsSh({ maxRecords: limit }),
              discoverOfficialMcpRegistry({
                maxRecords: limit,
                ...(options.query ? { search: options.query } : {}),
              }),
            ]);
          const leads: ReviewQueueLead[] = [
            ...(github.status === "fulfilled" ? github.value : []),
            ...(hackerNews.status === "fulfilled"
              ? hackerNews.value.candidates
              : []),
            ...(skillsSh.status === "fulfilled" ? skillsSh.value.records : []),
            ...(mcpRegistry.status === "fulfilled"
              ? mcpRegistry.value.records
              : []),
          ];
          if (!leads.length) {
            const failures = [github, hackerNews, skillsSh, mcpRegistry]
              .filter(
                (result): result is PromiseRejectedResult =>
                  result.status === "rejected",
              )
              .map((result) =>
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
              );
            const connectorIssues = [skillsSh, mcpRegistry].flatMap((result) =>
              result.status === "fulfilled"
                ? result.value.issues.map((issue) => issue.message)
                : [],
            );
            throw new Error(
              `All discovery sources returned no usable leads: ${[...failures, ...connectorIssues].join("; ")}`,
            );
          }
          const sourceWarnings = [github, hackerNews, skillsSh, mcpRegistry]
            .filter(
              (result): result is PromiseRejectedResult =>
                result.status === "rejected",
            )
            .map((result) =>
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            )
            .concat(
              [skillsSh, mcpRegistry].flatMap((result) =>
                result.status === "fulfilled"
                  ? result.value.issues.map(
                      (issue) => `${result.value.source}: ${issue.message}`,
                    )
                  : [],
              ),
            );
          const queue = options.queue
            ? await mergeReviewQueue(leads, await loadEffectiveCatalog())
            : undefined;
          const output = {
            leads,
            queue,
            sourceWarnings,
            connectorStatus: {
              skillsSh:
                skillsSh.status === "fulfilled"
                  ? skillsSh.value.status
                  : "failed",
              mcpRegistry:
                mcpRegistry.status === "fulfilled"
                  ? mcpRegistry.value.status
                  : "failed",
            },
          };
          if (options.json) return console.log(JSON.stringify(output, null, 2));
          if (queue) console.log(formatReviewQueue(queue));
          else
            console.log(
              `Multi-source discovery: ${leads.length} public lead(s).`,
            );
          for (const warning of sourceWarnings)
            console.error(`Warning: ${warning}`);
          return;
        }
        if (options.source === "github") {
          const repositories = await discoverGitHubRepositories({
            ...(options.query
              ? { query: options.query }
              : { queries: defaultGitHubDiscoveryQueries() }),
            limit,
          });
          if (options.queue) {
            const queue = await mergeReviewQueue(
              repositories,
              await loadEffectiveCatalog(),
            );
            if (options.json)
              return console.log(JSON.stringify(queue, null, 2));
            console.log(formatReviewQueue(queue));
            return;
          }
          if (options.json)
            return console.log(JSON.stringify(repositories, null, 2));
          console.log(`GitHub: ${repositories.length} repository lead(s)`);
          for (const repository of repositories)
            console.log(
              `★${repository.stars} · ${repository.repository} — ${repository.description}`,
            );
          return;
        }
        if (options.source === "skills-sh") {
          const result = await discoverSkillsSh({ maxRecords: limit });
          const queue = options.queue
            ? await mergeReviewQueue(
                result.records,
                await loadEffectiveCatalog(),
              )
            : undefined;
          if (options.json)
            return console.log(JSON.stringify({ result, queue }, null, 2));
          if (queue) console.log(formatReviewQueue(queue));
          else
            console.log(
              `skills.sh (${result.status}): ${result.records.length} metadata lead(s); leaderboard popularity is not a safety or quality verdict.`,
            );
          for (const issue of result.issues)
            console.error(`Warning: ${issue.message}`);
          return;
        }
        if (options.source === "mcp-registry") {
          const result = await discoverOfficialMcpRegistry({
            maxRecords: limit,
            ...(options.query ? { search: options.query } : {}),
          });
          const queue = options.queue
            ? await mergeReviewQueue(
                result.records,
                await loadEffectiveCatalog(),
              )
            : undefined;
          if (options.json)
            return console.log(JSON.stringify({ result, queue }, null, 2));
          if (queue) console.log(formatReviewQueue(queue));
          else
            console.log(
              `Official MCP Registry (${result.status}): ${result.records.length} identity/distribution lead(s); registry presence is not a Loadout safety approval.`,
            );
          for (const issue of result.issues)
            console.error(`Warning: ${issue.message}`);
          return;
        }
        if (options.source !== "hacker-news")
          throw new Error(
            `Unsupported discovery source '${options.source}'. Supported: github, hacker-news, skills-sh, mcp-registry, all`,
          );
        const minScore = Number(options.minScore);
        if (!Number.isFinite(minScore) || minScore < 0)
          throw new Error("--min-score must be a non-negative number");
        const result = await discoverHackerNewsRepositories({
          limit,
          minScore,
          keywords: options.query?.split(",") ?? [],
        });
        if (options.queue) {
          const queue = await mergeReviewQueue(
            result.candidates,
            await loadEffectiveCatalog(),
          );
          if (options.json) return console.log(JSON.stringify(queue, null, 2));
          console.log(formatReviewQueue(queue));
          return;
        }
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        console.log(
          `Hacker News: ${result.candidates.length} GitHub repository lead(s) from ${result.storiesScanned} stories.`,
        );
        for (const candidate of result.candidates) {
          console.log(
            `★${candidate.score} · ${candidate.repository} — ${candidate.title}\n  ${candidate.discussionUrl}`,
          );
        }
      },
    );

  program
    .command("review-queue")
    .description(
      "Show deduplicated discovery leads awaiting human review; never installs",
    )
    .option("--decision <value>", "filter: pending, shortlisted, or ignored")
    .option("--json", "emit machine-readable JSON")
    .action(async (options: { decision?: string; json?: boolean }) => {
      const queue = await readReviewQueue();
      if (
        options.decision &&
        !["pending", "shortlisted", "ignored"].includes(options.decision)
      )
        throw new Error("--decision must be pending, shortlisted, or ignored");
      const filtered = options.decision
        ? {
            ...queue,
            items: queue.items.filter(
              (item) => item.decision === options.decision,
            ),
          }
        : queue;
      console.log(
        options.json
          ? JSON.stringify(filtered, null, 2)
          : formatReviewQueue(filtered),
      );
    });

  program
    .command("review")
    .description(
      "Record a human queue decision; shortlisting still does not promote or install",
    )
    .argument("<repository>", "owner/repository")
    .requiredOption("--decision <value>", "pending, shortlisted, or ignored")
    .action(async (repository: string, options: { decision: string }) => {
      if (!["pending", "shortlisted", "ignored"].includes(options.decision))
        throw new Error("--decision must be pending, shortlisted, or ignored");
      const item = await setReviewDecision(
        repository,
        options.decision as ReviewDecision,
      );
      console.log(
        `${item.repository}: ${item.decision}. No catalog or agent files changed.`,
      );
    });

  const credentials = program
    .command("credentials")
    .description(
      "Store, inspect, or remove secrets in the native OS credential store",
    );

  credentials
    .command("status")
    .description("Check whether the native OS credential backend is available")
    .option("--json", "emit machine-readable status")
    .action(async (options: { json?: boolean }) => {
      const status = await createOsCredentialStore().status();
      console.log(
        options.json
          ? JSON.stringify(status, null, 2)
          : `${status.backend}: ${status.available ? "available" : "unavailable"}`,
      );
      if (!status.available) process.exitCode = 1;
    });

  credentials
    .command("set")
    .description(
      "Store a credential read from stdin; its value is never placed in arguments or output",
    )
    .argument("<service>", "credential service identifier")
    .option("--account <account>", "credential account")
    .requiredOption("--stdin", "require secret input from stdin")
    .action(async (service: string, options: { account?: string }) => {
      await createOsCredentialStore().set(
        {
          kind: "os-keychain",
          service,
          ...(options.account ? { account: options.account } : {}),
        },
        await readCredentialFromStdin(),
      );
      console.log(`Stored '${service}' in the native OS credential store.`);
    });

  credentials
    .command("check")
    .description("Check whether one credential resolves without printing it")
    .argument("<service>", "credential service identifier")
    .option("--account <account>", "credential account")
    .option("--json", "emit machine-readable status")
    .action(
      async (
        service: string,
        options: { account?: string; json?: boolean },
      ) => {
        const found = Boolean(
          await createOsCredentialStore().get({
            kind: "os-keychain",
            service,
            ...(options.account ? { account: options.account } : {}),
          }),
        );
        console.log(
          options.json
            ? JSON.stringify({ service, found })
            : `${service}: ${found ? "stored" : "not found"}`,
        );
        if (!found) process.exitCode = 1;
      },
    );

  credentials
    .command("delete")
    .description("Remove one credential from the native OS store")
    .argument("<service>", "credential service identifier")
    .option("--account <account>", "credential account")
    .action(async (service: string, options: { account?: string }) => {
      const deleted = await createOsCredentialStore().delete({
        kind: "os-keychain",
        service,
        ...(options.account ? { account: options.account } : {}),
      });
      console.log(`${service}: ${deleted ? "deleted" : "not found"}`);
    });

  const models = program
    .command("models")
    .description(
      "Plan, apply, inspect, or verify secret-free provider model selections",
    );

  models
    .command("status")
    .description("Show configured model metadata and credential references")
    .option("--config <path>", "model configuration path")
    .option("--json", "emit machine-readable JSON")
    .action(async (options: { config?: string; json?: boolean }) => {
      const configuration = await readProviderModelConfiguration(
        options.config ?? defaultModelConfigurationPath(),
      );
      console.log(
        options.json
          ? JSON.stringify(configuration ?? null, null, 2)
          : formatProviderModelConfiguration(configuration),
      );
    });

  models
    .command("set")
    .description("Plan or store one provider selection; never stores a raw key")
    .requiredOption("--id <id>", "selection id")
    .requiredOption("--model <model>", "provider model identifier")
    .option("--provider <provider>", "provider id", "openrouter")
    .option(
      "--endpoint <url>",
      "provider HTTPS endpoint",
      "https://openrouter.ai/api/v1",
    )
    .option(
      "--credential-env <name>",
      "environment variable reference (default: OPENROUTER_API_KEY)",
    )
    .option(
      "--credential-keychain <service>",
      "native OS credential service reference",
    )
    .option("--credential-account <account>", "native credential account")
    .option("--agents <ids>", "comma-separated target agent ids")
    .option("--config <path>", "model configuration path")
    .option("--yes", "apply after preview")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (options: {
        id: string;
        model: string;
        provider: string;
        endpoint: string;
        credentialEnv?: string;
        credentialKeychain?: string;
        credentialAccount?: string;
        agents?: string;
        config?: string;
        yes?: boolean;
        json?: boolean;
      }) => {
        if (options.credentialEnv && options.credentialKeychain)
          throw new Error(
            "Choose either --credential-env or --credential-keychain",
          );
        if (options.credentialAccount && !options.credentialKeychain)
          throw new Error(
            "--credential-account requires --credential-keychain",
          );
        const credential = options.credentialKeychain
          ? {
              kind: "os-keychain" as const,
              service: options.credentialKeychain,
              ...(options.credentialAccount
                ? { account: options.credentialAccount }
                : {}),
            }
          : {
              kind: "environment" as const,
              name: options.credentialEnv ?? "OPENROUTER_API_KEY",
            };
        const plan = await planProviderModelSelection(
          {
            id: options.id,
            provider: options.provider,
            model: options.model,
            endpoint: options.endpoint,
            credential,
            ...(options.agents
              ? { targetAgents: parseAgentSelection(options.agents)! }
              : {}),
          },
          options.config ?? defaultModelConfigurationPath(),
        );
        if (!options.yes) {
          console.log(
            options.json
              ? JSON.stringify(plan, null, 2)
              : `${formatProviderModelConfiguration(plan.configuration)}\nPath: ${plan.path}\nDry run only. Re-run with --yes to save metadata and the credential reference.`,
          );
          return;
        }
        const snapshotId = await applyProviderModelSelection(plan);
        console.log(
          options.json
            ? JSON.stringify(
                { configuration: plan.configuration, snapshotId },
                null,
                2,
              )
            : `${formatProviderModelConfiguration(plan.configuration)}\nSaved. Snapshot: ${snapshotId}`,
        );
      },
    );

  models
    .command("verify")
    .description(
      "Make one explicit minimal provider request using the referenced credential",
    )
    .argument("<id>", "selection id")
    .option("--config <path>", "model configuration path")
    .action(async (id: string, options: { config?: string }) => {
      const configuration = await readProviderModelConfiguration(
        options.config ?? defaultModelConfigurationPath(),
      );
      if (!configuration)
        throw new Error("No provider model configuration exists");
      await requestOpenRouter(
        configuration,
        id,
        [
          {
            role: "user",
            content: "Reply with the single word OK.",
          },
        ],
        {
          resolveCredential: createCredentialResolver(),
        },
      );
      console.log(
        `Verified model selection '${id}'. No credential value was stored or printed.`,
      );
    });

  const handoff = program
    .command("handoff")
    .description(
      "Cross-agent file-based task handoff — send work between Claude Code, Codex, and other agents",
    );

  handoff
    .command("init")
    .description(
      "Create the .handoff/ protocol directory in the current project",
    )
    .action(async () => {
      const projectRoot = process.cwd();
      if (await isHandoffInitialized(projectRoot)) {
        console.log("Handoff already initialized at .handoff/");
        return;
      }
      const dir = await initHandoff(projectRoot);
      console.log(`Initialized handoff protocol at ${dir}`);
      console.log(
        "Add .handoff/ to version control so both agents share the message log.",
      );
    });

  handoff
    .command("send")
    .description("Send a task or message to another agent")
    .argument("<agent>", "target agent (e.g. codex, claude-code)")
    .argument("<description...>", "task description")
    .option("--from <agent>", "sending agent", "user")
    .option(
      "--type <type>",
      "message type: task, handoff, question, status, error, cancel",
      "task",
    )
    .option("--context <text>", "additional context for the receiving agent")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (
        agent: string,
        descriptionWords: string[],
        options: {
          from: string;
          type: string;
          context?: string;
          json?: boolean;
        },
      ) => {
        const message = await sendHandoff(
          process.cwd(),
          agent,
          descriptionWords.join(" "),
          {
            from: options.from,
            type: options.type as "task",
            context: options.context,
          },
        );
        console.log(
          options.json
            ? JSON.stringify(message, null, 2)
            : `Sent ${message.type} ${message.id} → ${message.to}: ${message.description}`,
        );
      },
    );

  handoff
    .command("done")
    .description("Mark a handoff task as completed")
    .argument("<id>", "message id to mark done")
    .option("--json", "emit machine-readable JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const message = await markDone(process.cwd(), id);
      console.log(
        options.json
          ? JSON.stringify(message, null, 2)
          : `Marked ${id} as done`,
      );
    });

  handoff
    .command("inbox")
    .description(
      "Show pending tasks addressed to one agent, as instructions it can act on",
    )
    .argument("<agent>", "agent reading its inbox (e.g. claude-code, codex)")
    .option("--json", "emit machine-readable JSON")
    .action(async (agent: string, options: { json?: boolean }) => {
      const messages = await readInbox(process.cwd(), agent);
      console.log(
        options.json
          ? JSON.stringify(messages, null, 2)
          : formatInbox(agent, messages),
      );
    });

  handoff
    .command("pickup")
    .description(
      "Teach agents to check their handoff inbox by adding a managed block to CLAUDE.md / AGENTS.md",
    )
    .option(
      "--agents <ids>",
      "comma-separated agents to instruct",
      "claude-code,codex",
    )
    .option("--yes", "write the files after previewing")
    .action(async (options: { agents: string; yes?: boolean }) => {
      const agents = options.agents
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const plans = [];
      for (const agent of agents)
        plans.push(await planPickup(process.cwd(), agent));
      console.log(formatPickupPlan(plans));
      if (!options.yes) {
        console.log("\nPreview only. Re-run with --yes to write these files.");
        return;
      }
      for (const plan of plans) await applyPickup(plan);
      console.log(
        `\nWrote pickup instructions for ${plans.length} agent(s). They will check their inbox on the next session.`,
      );
    });

  handoff
    .command("status")
    .description("Show pending and completed handoff tasks")
    .option("--json", "emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const state = await getHandoffState(process.cwd());
      console.log(
        options.json
          ? JSON.stringify(state, null, 2)
          : formatHandoffStatus(state),
      );
    });

  const route = program
    .command("route")
    .description(
      "Recommend the right model tier and agent for a task — plan, implement, review, test, debug, or document",
    );

  route
    .argument("[description...]", "natural-language task description")
    .option("--phase <phase>", "explicit phase instead of auto-classify")
    .option(
      "--conserve",
      "recommend cheaper tiers to stretch remaining session quota",
    )
    .option("--cost", "show cost comparison table across all phases")
    .option("--models", "list the full model catalog Loadout knows about")
    .option(
      "--provider <name>",
      "filter models by provider (anthropic, openai, google, deepseek, meta)",
    )
    .option("--tier <tier>", "filter models by tier (frontier, standard, fast)")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (
        descriptionWords: string[],
        options: {
          phase?: string;
          conserve?: boolean;
          cost?: boolean;
          models?: boolean;
          provider?: string;
          tier?: string;
          json?: boolean;
        },
      ) => {
        if (options.models) {
          console.log(
            options.json
              ? JSON.stringify(
                  (await import("../core/route.js")).MODEL_CATALOG,
                  null,
                  2,
                )
              : formatModelCatalog({
                  provider: options.provider,
                  tier: options.tier,
                }),
          );
          return;
        }
        if (options.cost) {
          console.log(
            options.json
              ? JSON.stringify(
                  (await import("../core/route.js")).estimateCostSavings(),
                  null,
                  2,
                )
              : formatCostTable(),
          );
          return;
        }
        const description = descriptionWords.join(" ").trim();
        if (!description && !options.phase) {
          console.log(
            options.json
              ? JSON.stringify(allPhaseRoutes(options.conserve), null, 2)
              : formatRoutingTable(options.conserve),
          );
          return;
        }
        const rec = options.phase
          ? routePhase(options.phase as TaskPhase, options.conserve)
          : routeTask(description, options.conserve);
        // Recommendations are only useful when they name agents this machine
        // actually has, so detection drives both the advice and the handoff line.
        const detected = await detectAgents();
        const installedAgents = detected
          .filter((agent) => agent.installed)
          .map((agent) => agent.id);
        console.log(
          options.json
            ? JSON.stringify({ ...rec, installedAgents }, null, 2)
            : formatRouteRecommendation(rec, {
                installedAgents,
                ...(description ? { description } : {}),
                handoffReady: await isHandoffInitialized(process.cwd()),
              }),
        );
      },
    );

  program
    .command("completion")
    .description(
      "Print a shell-completion script; redirect it to your shell profile",
    )
    .argument("<shell>", "bash, zsh, fish, or powershell")
    .action((shell: string) => {
      process.stdout.write(renderShellCompletion(parseCompletionShell(shell)));
    });
}
