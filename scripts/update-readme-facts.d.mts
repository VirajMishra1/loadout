export interface ReadmeFactUpdateOptions {
  path?: string;
  check?: boolean;
}

export interface ReadmeFactUpdateResult {
  changed: boolean;
  wrote: boolean;
}

export function renderReadmeFactBlocks(): Promise<Record<string, string>>;

export function replaceGeneratedBlock(
  readme: string,
  name: string,
  content: string,
): string;

export function updateReadmeFacts(
  options?: ReadmeFactUpdateOptions,
): Promise<ReadmeFactUpdateResult>;
