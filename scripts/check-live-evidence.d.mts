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
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  runCommand?: (
    file: string,
    args: string[],
    options?: Record<string, unknown>,
  ) => Promise<CommandResult>;
}

export function parseLiveCheckReport(
  value: unknown,
  expectedIds?: LiveCheckId[],
): LiveCheckReport;
export function runLiveChecks(
  options: LiveCheckOptions,
): Promise<LiveCheckReport>;
