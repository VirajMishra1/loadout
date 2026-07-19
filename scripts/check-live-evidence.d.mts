export type LiveCheckId = "npm" | "stable-install" | "github";
export type LiveCheckStatus = "verified" | "failed" | "not-verified";

export interface LiveCheckResult {
  id: LiveCheckId;
  status: LiveCheckStatus;
  detail: string;
}

export interface LiveCheckReport {
  schemaVersion: 1;
  generatedAt: string;
  repositoryCommit: string;
  checks: LiveCheckResult[];
}

interface PackageMetadata {
  name: string;
  version: string;
  repository?: string | { url?: string };
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface LiveCheckOptions {
  requested?: LiveCheckId[];
  packageJson: PackageMetadata;
  repositoryCommit?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  runCommand?: (
    file: string,
    args: string[],
    options?: Record<string, unknown>,
  ) => Promise<CommandResult>;
  /** Override the 100 MiB streaming cap for deterministic tests. */
  maxTarballBytes?: number;
}

export function parseLiveCheckReport(
  value: unknown,
  expectedIds?: LiveCheckId[],
): LiveCheckReport;
export function runLiveChecks(
  options: LiveCheckOptions,
): Promise<LiveCheckReport>;
