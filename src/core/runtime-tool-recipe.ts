import { posix, win32 } from "node:path";
import { z } from "zod";
import type { AgentId } from "../shared/types.js";

export type RuntimeRecipePlatform = "darwin" | "linux" | "win32";

const agentIds = [
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "opencode",
  "hermes",
  "windsurf",
  "cline",
  "github-copilot",
  "roo-code",
  "kiro-cli",
  "junie",
] as const satisfies readonly AgentId[];

const inheritedEnvironmentNames = [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "TMPDIR",
  "TMP",
  "TEMP",
] as const;

const fixedEnvironmentNames = [
  "HOME",
  "USERPROFILE",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "UV_CACHE_DIR",
] as const;

const recipePlatformSchema = z.enum(["darwin", "linux", "win32"]);
const agentIdSchema = z.enum(agentIds);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const safeIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const nonControlTextSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !/[\0\r\n]/u.test(value),
    "control characters are forbidden",
  );
const pathSegmentSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes(":") &&
      !/[. ]$/u.test(value) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(value) &&
      !/[\0\r\n]/u.test(value),
    "paths must be safe relative segments",
  );
const environmentValueSchema = z
  .object({
    root: z.enum(["userHome", "runtimeRoot"]),
    path: z.array(pathSegmentSchema).max(8),
  })
  .strict();

const artifactSchema = z
  .object({
    id: safeIdSchema,
    kind: z.enum(["python-wheel"]),
    packageName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    url: z.url().refine((url) => url.startsWith("https://"), "HTTPS required"),
    sha256: digestSchema,
  })
  .strict();

const commandExecutableSchema = nonControlTextSchema.refine(
  (value) =>
    value === "{runtimeBinary}" ||
    (/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) &&
      !new Set([
        "sh",
        "bash",
        "zsh",
        "fish",
        "cmd",
        "cmd.exe",
        "powershell",
        "powershell.exe",
        "pwsh",
      ]).has(value.toLowerCase())),
  "commands must name a non-shell executable directly",
);

const hostToolSchema = z
  .object({
    executable: commandExecutableSchema.refine(
      (value) => value !== "{runtimeBinary}",
      "host tools must name an external executable",
    ),
    versionPolicy: z.literal("unversioned-host-dependency"),
    purpose: nonControlTextSchema,
  })
  .strict();

const commandArgumentSchema = nonControlTextSchema.refine(
  (value) =>
    !value.includes("{") ||
    value === "{artifactRequirement}" ||
    value === "{version}",
  "unknown command template variable",
);

const commandSchema = z
  .object({
    executable: commandExecutableSchema,
    args: z.array(commandArgumentSchema).max(64),
    purpose: nonControlTextSchema,
  })
  .strict();

const registrationSchema = z
  .object({
    args: z.array(commandArgumentSchema).max(32),
    purpose: nonControlTextSchema,
  })
  .strict();

const targetSchema = z
  .object({
    path: z.array(pathSegmentSchema).min(1).max(16),
  })
  .strict();

const healthCheckSchema = commandSchema
  .extend({
    stdoutIncludes: z.enum(["{version}"]),
  })
  .strict();

const generatedFilesSchema = z
  .object({
    requiredRelativePaths: z.array(pathSegmentSchema).min(1),
    rejectSymlinks: z.literal(true),
    textRewrites: z.array(
      z
        .object({
          fileExtension: z.string().regex(/^\.[A-Za-z0-9]+$/),
          from: nonControlTextSchema,
          to: nonControlTextSchema.refine((value) => {
            const rendered = [
              "{artifactRequirement}",
              "{artifactUrl}",
              "{artifactSha256}",
            ].reduce(
              (current, placeholder) => current.replaceAll(placeholder, ""),
              value,
            );
            return !/[{}]/u.test(rendered);
          }, "unknown rewrite template variable"),
          mustEliminate: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const runtimeToolRecipeSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("loadout.reviewed-runtime-recipe"),
    id: safeIdSchema,
    displayName: nonControlTextSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
    source: z
      .url()
      .refine((url) => url.startsWith("https://"), "HTTPS required"),
    sourceRepository: z
      .url()
      .refine((url) => url.startsWith("https://"), "HTTPS required")
      .refine((url) => !url.endsWith("/"), "omit trailing repository slash"),
    reviewedCommit: commitSchema,
    artifactUrl: z
      .url()
      .refine((url) => url.startsWith("https://"), "HTTPS required"),
    artifactSha256: digestSchema,
    artifacts: z.array(artifactSchema).min(1).max(64),
    excludeNewer: z.iso.datetime({ offset: true }),
    license: z.string().regex(/^[A-Za-z0-9-.+]+$/),
    trust: z
      .object({
        reviewType: z.literal("manual-source-and-artifact-review"),
        reviewedAt: z.iso.datetime({ offset: true }),
        reviewer: nonControlTextSchema,
        provenance: z.literal("direct-upstream-and-package-index"),
      })
      .strict(),
    dependencies: z
      .object({
        resolution: z.enum(["fully-locked", "cutoff-bounded"]),
        excludeNewer: z.iso.datetime({ offset: true }).optional(),
        lockArtifactSha256: digestSchema.optional(),
        hostTools: z.array(hostToolSchema).min(1),
        disclosure: nonControlTextSchema,
      })
      .strict(),
    permissions: z.array(nonControlTextSchema).min(1),
    operatingSystems: z.array(recipePlatformSchema).min(1),
    environment: z
      .object({
        inherit: z.array(z.enum(inheritedEnvironmentNames)),
        fixed: z.record(z.enum(fixedEnvironmentNames), environmentValueSchema),
      })
      .strict(),
    runtime: z
      .object({
        root: z.tuple([z.literal("runtime"), z.literal("{recipeId}")]),
        binaryPaths: z
          .object({
            darwin: z.array(pathSegmentSchema).min(1),
            linux: z.array(pathSegmentSchema).min(1),
            win32: z.array(pathSegmentSchema).min(1),
          })
          .strict(),
      })
      .strict(),
    commands: z
      .object({
        install: z.array(commandSchema).min(1),
        register: z.partialRecord(agentIdSchema, registrationSchema),
      })
      .strict(),
    healthChecks: z.array(healthCheckSchema).min(1),
    targets: z.partialRecord(agentIdSchema, targetSchema),
    timeouts: z
      .object({
        commandMs: z.number().int().min(1_000).max(900_000),
      })
      .strict(),
    snapshotRoots: z
      .array(z.enum(["{runtimeRoot}", "{agentTargets}"]))
      .refine(
        (values) =>
          values.includes("{runtimeRoot}") && values.includes("{agentTargets}"),
        "runtime and agent targets must both be snapshotted",
      ),
    removal: z
      .object({
        strategy: z.literal("restore-preinstall-snapshot"),
        runtimeRoot: z.literal("restore-preinstall-state"),
      })
      .strict(),
    generatedFiles: generatedFilesSchema,
    guarantees: z.array(nonControlTextSchema).min(1),
  })
  .strict()
  .superRefine((recipe, context) => {
    const artifact = recipe.artifacts[0];
    if (artifact.url !== recipe.artifactUrl)
      context.addIssue({
        code: "custom",
        path: ["artifactUrl"],
        message: "top-level artifact URL must match artifacts[0]",
      });
    if (artifact.sha256 !== recipe.artifactSha256)
      context.addIssue({
        code: "custom",
        path: ["artifactSha256"],
        message: "top-level artifact digest must match artifacts[0]",
      });
    if (!recipe.source.includes(recipe.reviewedCommit))
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "reviewed source URL must include the exact commit",
      });
    if (!recipe.source.startsWith(`${recipe.sourceRepository}/`))
      context.addIssue({
        code: "custom",
        path: ["sourceRepository"],
        message: "reviewed source must belong to the declared repository",
      });
    if (
      new Set(recipe.artifacts.map((item) => item.id)).size !==
      recipe.artifacts.length
    )
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "artifact ids must be unique",
      });
    if (
      !recipe.commands.install.some((command) =>
        command.args.includes("{artifactRequirement}"),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["commands", "install"],
        message: "an install command must consume the pinned artifact",
      });
    const hostExecutables = new Set(
      recipe.dependencies.hostTools.map((tool) => tool.executable),
    );
    for (const [index, command] of recipe.commands.install.entries()) {
      if (
        command.executable !== "{runtimeBinary}" &&
        !hostExecutables.has(command.executable)
      )
        context.addIssue({
          code: "custom",
          path: ["commands", "install", index, "executable"],
          message: "install executable must be a declared host dependency",
        });
    }
    if (
      recipe.dependencies.resolution === "cutoff-bounded" &&
      recipe.dependencies.excludeNewer !== recipe.excludeNewer
    )
      context.addIssue({
        code: "custom",
        path: ["dependencies", "excludeNewer"],
        message: "dependency cutoff must match the installer cutoff",
      });
    if (
      recipe.dependencies.resolution === "fully-locked" &&
      !recipe.dependencies.lockArtifactSha256
    )
      context.addIssue({
        code: "custom",
        path: ["dependencies", "lockArtifactSha256"],
        message: "fully locked dependencies require a lock artifact digest",
      });
    if (
      recipe.dependencies.lockArtifactSha256 &&
      !recipe.artifacts.some(
        (artifact) =>
          artifact.sha256 === recipe.dependencies.lockArtifactSha256,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["dependencies", "lockArtifactSha256"],
        message: "dependency lock digest must identify a declared artifact",
      });
    for (const agent of Object.keys(recipe.commands.register)) {
      if (!(agent in recipe.targets))
        context.addIssue({
          code: "custom",
          path: ["targets", agent],
          message: "every registration command requires a target",
        });
    }
    for (const agent of Object.keys(recipe.targets)) {
      if (!(agent in recipe.commands.register))
        context.addIssue({
          code: "custom",
          path: ["commands", "register", agent],
          message: "every target requires a registration command",
        });
    }
  });

export type RuntimeToolRecipe = z.infer<typeof runtimeToolRecipeSchema>;

export function parseRuntimeToolRecipe(value: unknown): RuntimeToolRecipe {
  return runtimeToolRecipeSchema.parse(value);
}

export function runtimeArtifactRequirement(recipe: RuntimeToolRecipe): string {
  const artifact = recipe.artifacts[0];
  return `${artifact.packageName} @ ${artifact.url}#sha256=${artifact.sha256}`;
}

export function renderRuntimeRecipeValue(
  value: string,
  recipe: RuntimeToolRecipe,
): string {
  return value
    .replaceAll("{artifactRequirement}", runtimeArtifactRequirement(recipe))
    .replaceAll("{artifactUrl}", recipe.artifactUrl)
    .replaceAll("{artifactSha256}", recipe.artifactSha256)
    .replaceAll("{version}", recipe.version);
}

/** Resolve reviewed path segments without ever accepting a recipe-owned root. */
export function resolveRuntimeRecipePath(
  root: string,
  segments: readonly string[],
  platform: RuntimeRecipePlatform,
): string {
  const pathApi = platform === "win32" ? win32 : posix;
  return pathApi.join(root, ...segments);
}
