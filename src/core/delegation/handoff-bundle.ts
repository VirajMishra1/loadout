import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { writeFileAtomically } from "../install/atomic-file.js";
import { redactString } from "../coordination/redaction.js";

export const HANDOFF_BUNDLE_MAX_FILES = 20;
export const HANDOFF_BUNDLE_MAX_FILE_BYTES = 32 * 1024;
export const HANDOFF_BUNDLE_MAX_TOTAL_BYTES = 50 * 1024;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const handoffBundleFileSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .refine(
        (path) =>
          !path.startsWith("/") &&
          !path.split("/").includes("..") &&
          ![".git", ".handoff"].includes(path.split("/")[0] ?? ""),
        "must be a safe project-relative source path",
      ),
    sourceBytes: z.number().int().nonnegative(),
    storedBytes: z
      .number()
      .int()
      .nonnegative()
      .max(HANDOFF_BUNDLE_MAX_FILE_BYTES),
    sourceSha256: sha256Schema,
    isTruncated: z.boolean(),
    content: z.string(),
  })
  .strict();

const handoffBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    createdAt: z.iso.datetime({ offset: true }),
    files: z
      .array(handoffBundleFileSchema)
      .min(1)
      .max(HANDOFF_BUNDLE_MAX_FILES),
  })
  .strict()
  .superRefine((bundle, context) => {
    let total = 0;
    bundle.files.forEach((file, index) => {
      const actual = Buffer.byteLength(file.content);
      if (actual !== file.storedBytes) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "storedBytes"],
          message: "does not match the UTF-8 content byte length",
        });
      }
      total += actual;
    });
    if (total > HANDOFF_BUNDLE_MAX_TOTAL_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: `stored content exceeds ${HANDOFF_BUNDLE_MAX_TOTAL_BYTES} bytes`,
      });
    }
  });

export type HandoffBundle = z.infer<typeof handoffBundleSchema>;

export const handoffBundleReferenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    path: z.string().regex(/^\.handoff\/bundles\/[a-f0-9-]+\.json$/),
    fileCount: z.number().int().min(1).max(HANDOFF_BUNDLE_MAX_FILES),
    storedBytes: z
      .number()
      .int()
      .nonnegative()
      .max(HANDOFF_BUNDLE_MAX_TOTAL_BYTES),
    isTruncated: z.boolean(),
  })
  .strict();

export type HandoffBundleReference = z.infer<
  typeof handoffBundleReferenceSchema
>;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function assertNoSymlinkComponents(
  root: string,
  relativePath: string,
  allowMissing: boolean,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  let current = root;
  let finalInfo: Awaited<ReturnType<typeof lstat>> | undefined;
  for (const segment of relativePath.split("/")) {
    current = join(current, segment);
    try {
      finalInfo = await lstat(current);
    } catch (error) {
      if (allowMissing && errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
    if (finalInfo.isSymbolicLink())
      throw new Error(`Bundle path cannot use a symlink: ${relativePath}`);
  }
  return finalInfo;
}

async function readBoundedTextFile(
  absolute: string,
  path: string,
  maximumBytes: number,
): Promise<{
  sourceBytes: number;
  sourceSha256: string;
  content: string;
  storedBytes: number;
  isTruncated: boolean;
}> {
  const hash = createHash("sha256");
  const utf8Validator = new TextDecoder("utf-8", { fatal: true });
  const captured: Buffer[] = [];
  let capturedBytes = 0;
  let sourceBytes = 0;

  try {
    for await (const value of createReadStream(absolute)) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      sourceBytes += chunk.byteLength;
      hash.update(chunk);
      utf8Validator.decode(chunk, { stream: true });
      if (chunk.includes(0))
        throw new Error(`Bundle path appears to be binary: ${path}`);
      if (capturedBytes < maximumBytes) {
        const remaining = maximumBytes - capturedBytes;
        const part = chunk.subarray(0, remaining);
        captured.push(part);
        capturedBytes += part.byteLength;
      }
    }
    utf8Validator.decode();
  } catch (error) {
    if (error instanceof Error && /appears to be binary/.test(error.message))
      throw error;
    if (error instanceof TypeError)
      throw new Error(`Bundle path appears to be binary: ${path}`);
    throw error;
  }

  const prefix = Buffer.concat(captured);
  let decoded = "";
  let trim = 0;
  for (; trim <= Math.min(3, prefix.byteLength); trim += 1) {
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        prefix.subarray(0, prefix.byteLength - trim),
      );
      break;
    } catch {
      // A bounded prefix can end in the middle of one UTF-8 code point.
    }
  }
  if (trim > Math.min(3, prefix.byteLength))
    throw new Error(`Bundle path appears to be binary: ${path}`);

  const redacted = redactString(decoded);
  const redactedBytes = Buffer.from(redacted);
  let content = redacted;
  if (redactedBytes.byteLength > maximumBytes) {
    for (let remove = 0; remove <= 3; remove += 1) {
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(
          redactedBytes.subarray(0, maximumBytes - remove),
        );
        break;
      } catch {
        // Keep trimming until the byte cap lands on a UTF-8 boundary.
      }
    }
  }
  const storedBytes = Buffer.byteLength(content);
  return {
    sourceBytes,
    sourceSha256: hash.digest("hex"),
    content,
    storedBytes,
    isTruncated:
      sourceBytes > capturedBytes ||
      trim > 0 ||
      redactedBytes.byteLength > maximumBytes,
  };
}

function projectRelativePath(
  projectRoot: string,
  requestedPath: string,
): string {
  if (!requestedPath.trim()) throw new Error("Bundle path cannot be empty");
  if (isAbsolute(requestedPath))
    throw new Error(`Bundle path must be project-relative: ${requestedPath}`);

  const root = resolve(projectRoot);
  const absolute = resolve(root, requestedPath);
  const local = relative(root, absolute);
  if (!local || local === ".." || local.startsWith(`..${sep}`))
    throw new Error(
      `Bundle path must stay inside the project: ${requestedPath}`,
    );
  const normalized = local.split(sep).join(posix.sep);
  const firstSegment = normalized.split(posix.sep)[0];
  if (firstSegment === ".git" || firstSegment === ".handoff")
    throw new Error(
      `Bundle path cannot read Loadout or Git internal state: ${requestedPath}`,
    );
  return normalized;
}

export async function createHandoffBundle(
  projectRoot: string,
  requestedPaths: string[],
): Promise<HandoffBundleReference> {
  if (!requestedPaths.length)
    throw new Error("Bundle requires at least one file");
  if (requestedPaths.length > HANDOFF_BUNDLE_MAX_FILES)
    throw new Error(`Bundle accepts at most ${HANDOFF_BUNDLE_MAX_FILES} files`);
  const files: HandoffBundle["files"] = [];
  const canonicalRoot = await realpath(projectRoot);
  let totalStoredBytes = 0;
  for (const requestedPath of requestedPaths) {
    const path = projectRelativePath(projectRoot, requestedPath);
    const absolute = resolve(canonicalRoot, path);
    const info = await assertNoSymlinkComponents(canonicalRoot, path, false);
    if (!info) throw new Error(`Bundle path does not exist: ${path}`);
    if (!info.isFile()) throw new Error(`Bundle path is not a file: ${path}`);
    const remaining = HANDOFF_BUNDLE_MAX_TOTAL_BYTES - totalStoredBytes;
    const snapshot = await readBoundedTextFile(
      absolute,
      path,
      Math.min(HANDOFF_BUNDLE_MAX_FILE_BYTES, remaining),
    );
    files.push({
      path,
      ...snapshot,
    });
    totalStoredBytes += snapshot.storedBytes;
  }

  const bundle: HandoffBundle = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    files,
  };
  const id = randomUUID();
  const path = `.handoff/bundles/${id}.json`;
  await assertNoSymlinkComponents(canonicalRoot, ".handoff/bundles", true);
  await writeFileAtomically(
    resolve(projectRoot, path),
    `${JSON.stringify(bundle, null, 2)}\n`,
  );
  return {
    schemaVersion: 1,
    path,
    fileCount: files.length,
    storedBytes: totalStoredBytes,
    isTruncated: files.some((file) => file.isTruncated),
  };
}

export async function readHandoffBundle(
  projectRoot: string,
  reference: HandoffBundleReference,
): Promise<HandoffBundle> {
  const validReference = handoffBundleReferenceSchema.parse(reference);
  const canonicalRoot = await realpath(projectRoot);
  await assertNoSymlinkComponents(canonicalRoot, validReference.path, false);
  const raw = await readFile(
    resolve(canonicalRoot, validReference.path),
    "utf8",
  );
  let bundle: HandoffBundle;
  try {
    bundle = handoffBundleSchema.parse(JSON.parse(raw));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unparseable JSON";
    throw new Error(
      `Invalid handoff bundle '${validReference.path}': ${reason}`,
    );
  }
  const storedBytes = bundle.files.reduce(
    (total, file) => total + file.storedBytes,
    0,
  );
  const isTruncated = bundle.files.some((file) => file.isTruncated);
  if (
    validReference.fileCount !== bundle.files.length ||
    validReference.storedBytes !== storedBytes ||
    validReference.isTruncated !== isTruncated
  ) {
    throw new Error(
      `Handoff bundle reference does not match '${validReference.path}'`,
    );
  }
  return bundle;
}

/** Remove only a schema-valid bundle path, used to roll back a failed send. */
export async function removeHandoffBundle(
  projectRoot: string,
  reference: HandoffBundleReference,
): Promise<void> {
  const validReference = handoffBundleReferenceSchema.parse(reference);
  const canonicalRoot = await realpath(projectRoot);
  await assertNoSymlinkComponents(canonicalRoot, validReference.path, true);
  await rm(resolve(canonicalRoot, validReference.path), { force: true });
}
