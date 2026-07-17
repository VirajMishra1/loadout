export interface ReadmeFactUpdateOptions {
  path?: string;
  check?: boolean;
}

export interface ReadmeFactUpdateResult {
  changed: boolean;
  wrote: boolean;
}

export interface ReadmeFactBlockSources {
  coverage: {
    technicallyScreenedRecords: number;
    recommendedRecords: number;
    trustStages: Record<string, number>;
  };
  facts: {
    catalog: {
      records: number;
      categories: number;
      components: { skill: number };
      installShapes: { mcpOnly: number };
      noAssertionLicenses: number;
    };
    agents: { supportedNames: string[] };
  };
  packageJson: { scripts: { verify: string } };
}

export function renderReadmeFactBlocks(): Promise<Record<string, string>>;

export function renderReadmeFactBlocksFromSources(
  sources: ReadmeFactBlockSources,
): Record<string, string>;

export function replaceGeneratedBlock(
  readme: string,
  name: string,
  content: string,
): string;

export function updateReadmeFacts(
  options?: ReadmeFactUpdateOptions,
): Promise<ReadmeFactUpdateResult>;
