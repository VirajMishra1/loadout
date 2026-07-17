export interface ReadmeClaimFailure {
  claimId: string;
  observed: string;
  authoritativeSource: string;
  remediation: string;
}

export interface ReadmeClaimAuditResult {
  ok: boolean;
  failures: ReadmeClaimFailure[];
}

export interface ReadmeClaimAuditOptions {
  root: string;
  readme: string;
  manifest: unknown;
  packageJson: {
    scripts?: Record<string, string>;
  };
  facts: {
    catalog: { records: number };
    agents: { supportedNames: string[] };
    package: { name: string; version: string; bin: Record<string, string> };
    runtime: { node: string };
  };
  releaseIndex: {
    releaseBlocked: boolean;
    claims: Array<{
      id: string;
      evidence: { commands: string[] };
    }>;
    blockers: string[];
  };
  cliPath: string;
}

export function documentedLoadoutCommands(readme: string): string[];

export function auditDocumentedCommands(options: {
  readme: string;
  cliPath: string;
}): ReadmeClaimFailure[];

export function auditReadmeClaims(
  options: ReadmeClaimAuditOptions,
): Promise<ReadmeClaimAuditResult>;

export function formatReadmeClaimFailures(
  failures: ReadmeClaimFailure[],
): string;
