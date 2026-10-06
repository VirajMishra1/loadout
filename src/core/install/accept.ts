import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import type {
  InstallState,
  ManagedActivationRecord,
} from "../../shared/types.js";
import { managedFileReadPath } from "../workspace/active-set.js";
import {
  installStatePath,
  readInstallState,
  writeInstallState,
} from "../workspace/state.js";
import { runMutationTransaction } from "./transaction.js";

export interface AcceptedFile {
  packageId: string;
  /** The path recorded in the install record. */
  path: string;
  /** Where the bytes are read from: the active tree, or the library copy of a disabled skill. */
  readPath: string;
  recordedSha256: string;
  actualSha256: string;
}

export interface AcceptPlan {
  /** The skill or package id that was selected, or null for every drifted file. */
  selector: string | null;
  agent: string | null;
  files: AcceptedFile[];
  /** Recorded files that no longer exist; accepting cannot restore them. */
  missing: Array<{ packageId: string; path: string }>;
}

export interface AcceptSelection {
  selector: string | null;
  agent?: string;
}

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function selected(
  packageId: string,
  path: string,
  activations: ManagedActivationRecord[],
  selection: AcceptSelection,
): boolean {
  const owning = activations.filter(
    (activation) =>
      activation.packageId === packageId &&
      activation.targets.some((target) => isInside(target.activePath, path)),
  );
  if (selection.agent && owning.length) {
    if (!owning.some((activation) => activation.agent === selection.agent))
      return false;
  }
  if (selection.selector === null || selection.selector === packageId)
    return true;
  return owning.some(
    (activation) =>
      (!selection.agent || activation.agent === selection.agent) &&
      (activation.unitId === selection.selector ||
        activation.targets.some(
          (target) =>
            isInside(target.activePath, path) &&
            target.activePath.split(sep).at(-1) === selection.selector,
        )),
  );
}

function selectorExists(
  state: InstallState,
  selection: AcceptSelection,
): boolean {
  if (selection.selector === null) return true;
  return (
    state.installs.some((record) => record.packageId === selection.selector) ||
    (state.activations ?? []).some(
      (activation) =>
        activation.unitId === selection.selector ||
        activation.targets.some(
          (target) =>
            target.activePath.split(sep).at(-1) === selection.selector,
        ),
    )
  );
}

async function buildPlan(
  state: InstallState,
  selection: AcceptSelection,
): Promise<AcceptPlan> {
  if (!selectorExists(state, selection))
    throw new Error(
      `No managed skill or package named '${selection.selector}'. Run loadout library --all to see managed names.`,
    );
  const activations = state.activations ?? [];
  const plan: AcceptPlan = {
    selector: selection.selector,
    agent: selection.agent ?? null,
    files: [],
    missing: [],
  };
  for (const record of state.installs) {
    for (const file of record.files) {
      if (!selected(record.packageId, file.path, activations, selection))
        continue;
      const readPath = managedFileReadPath(
        record.packageId,
        file.path,
        activations,
      );
      let actual: string;
      try {
        actual = sha256(await readFile(readPath));
      } catch {
        plan.missing.push({ packageId: record.packageId, path: file.path });
        continue;
      }
      if (actual !== file.sha256)
        plan.files.push({
          packageId: record.packageId,
          path: file.path,
          readPath,
          recordedSha256: file.sha256,
          actualSha256: actual,
        });
    }
  }
  return plan;
}

export async function planAccept(
  selection: AcceptSelection,
): Promise<AcceptPlan> {
  return buildPlan(await readInstallState(), selection);
}

function libraryEntryPath(
  activation: ManagedActivationRecord,
  readPath: string,
): string | undefined {
  if (!isInside(activation.libraryPath, readPath)) return undefined;
  return relative(activation.libraryPath, readPath).split(sep).join("/");
}

export async function applyAccept(plan: AcceptPlan): Promise<string> {
  if (plan.missing.length)
    throw new Error(
      `${plan.missing.length} recorded file(s) are missing and cannot be accepted; reinstall or remove the owning package first.`,
    );
  if (!plan.files.length) throw new Error("No edited files to accept.");
  const applied = await runMutationTransaction(
    async () => {
      const fresh = await planAccept({
        selector: plan.selector,
        agent: plan.agent ?? undefined,
      });
      const key = (file: AcceptedFile) =>
        `${file.packageId}\0${file.path}\0${file.actualSha256}`;
      const previewed = new Set(plan.files.map(key));
      if (
        fresh.files.length !== plan.files.length ||
        fresh.missing.length ||
        !fresh.files.every((file) => previewed.has(key(file)))
      )
        throw new Error(
          "The edited files changed after preview; run loadout accept again to review them.",
        );
      return { targets: [installStatePath()], value: plan.files };
    },
    async (files) => {
      const state = await readInstallState();
      for (const file of files) {
        const record = state.installs.find(
          (install) => install.packageId === file.packageId,
        );
        const entry = record?.files.find((item) => item.path === file.path);
        if (!entry)
          throw new Error(
            `${file.packageId}: ${file.path} is no longer recorded; run loadout accept again.`,
          );
        entry.sha256 = file.actualSha256;
        if (file.readPath === file.path) continue;
        for (const activation of state.activations ?? []) {
          if (activation.packageId !== file.packageId) continue;
          const libraryPath = libraryEntryPath(activation, file.readPath);
          const libraryEntry =
            libraryPath &&
            activation.libraryFiles.find((item) => item.path === libraryPath);
          if (libraryEntry) libraryEntry.sha256 = file.actualSha256;
        }
      }
      await writeInstallState(state);
    },
    { label: `accept ${plan.selector ?? "all drifted files"}` },
  );
  return applied.snapshotId;
}

export function formatAcceptPlan(plan: AcceptPlan): string {
  const scope = plan.selector ?? "every drifted managed file";
  const lines = [
    `Accept local edits: ${scope}${plan.agent ? ` (${plan.agent})` : ""}`,
  ];
  if (!plan.files.length && !plan.missing.length)
    lines.push("No edited files; the recorded hashes already match.");
  for (const file of plan.files)
    lines.push(`  edited  ${file.packageId}  ${file.readPath}`);
  for (const file of plan.missing)
    lines.push(`  missing ${file.packageId}  ${file.path}`);
  if (plan.missing.length)
    lines.push(
      "Missing files cannot be accepted; reinstall or remove the owning package first.",
    );
  return lines.join("\n");
}
