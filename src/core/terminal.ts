const MIN_WIDTH = 80;
const MAX_WIDTH = 200;

export function terminalWidth(value = process.stdout.columns): number {
  if (!Number.isFinite(value)) return 120;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(value!)));
}

function fit(value: string, width: number): string {
  if (value.length <= width) return value.padEnd(width);
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

/** Render a deterministic ANSI-free table bounded to an 80-200 column terminal. */
export function formatTerminalTable(
  headers: string[],
  rows: string[][],
  requestedWidth?: number,
): string {
  if (!headers.length) return "";
  if (rows.some((row) => row.length !== headers.length))
    throw new Error("Terminal table rows must match the header width");
  const width = terminalWidth(requestedWidth);
  const separatorWidth = (headers.length - 1) * 3;
  const available = Math.max(headers.length, width - separatorWidth);
  const columns = headers.map((header, index) =>
    Math.max(
      header.length,
      ...rows.map((row) => row[index].length),
      Math.min(4, available),
    ),
  );
  while (columns.reduce((sum, column) => sum + column, 0) > available) {
    const largest = Math.max(...columns);
    const index = columns.findIndex((column) => column === largest);
    if (columns[index] <= 1) break;
    columns[index]--;
  }
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => fit(cell, columns[index]))
      .join(" | ")
      .trimEnd();
  return [
    line(headers),
    columns.map((column) => "-".repeat(column)).join("-|-"),
    ...rows.map(line),
  ].join("\n");
}
