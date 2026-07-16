import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildIntelligenceFeedPayload } from "../src/core/intelligence-feed-build.js";
import { createSignedIntelligenceFeed } from "../src/core/intelligence-feed.js";
import { writeFileAtomically } from "../src/core/atomic-file.js";

function argumentsFromCli(argv: string[]): {
  discovery: string;
  privateKey: string;
  output: string;
  sequence: number;
  expiresHours: number;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined)
      throw new Error("Feed builder expects --flag value pairs");
    values.set(flag, value);
  }
  const discovery = values.get("--discovery") ?? "catalog/discovered.json";
  const privateKey = values.get("--private-key");
  const output = values.get("--output") ?? "catalog/intelligence.json";
  const sequence = Number(values.get("--sequence"));
  const expiresHours = Number(values.get("--expires-hours") ?? "48");
  if (!privateKey) throw new Error("--private-key is required");
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error("--sequence must be a positive safe integer");
  if (!Number.isInteger(expiresHours) || expiresHours < 1 || expiresHours > 168)
    throw new Error("--expires-hours must be an integer from 1 to 168");
  return { discovery, privateKey, output, sequence, expiresHours };
}

const options = argumentsFromCli(process.argv.slice(2));
const discovery: unknown = JSON.parse(
  await readFile(resolve(options.discovery), "utf8"),
);
const generatedAt = (discovery as { generatedAt?: unknown }).generatedAt;
if (
  typeof generatedAt !== "string" ||
  !Number.isFinite(Date.parse(generatedAt))
)
  throw new Error("Discovery artifact has no valid generatedAt timestamp");
const payload = buildIntelligenceFeedPayload({
  discovery,
  sequence: options.sequence,
  expiresAt: new Date(
    Date.parse(generatedAt) + options.expiresHours * 60 * 60 * 1000,
  ).toISOString(),
});
const privateKey = await readFile(resolve(options.privateKey), "utf8");
const envelope = createSignedIntelligenceFeed(payload, privateKey);
const output = resolve(options.output);
await writeFileAtomically(
  output,
  `${JSON.stringify(envelope, null, 2)}\n`,
  0o644,
);
console.log(
  `Wrote signed public intelligence sequence ${payload.sequence} with ${payload.discoveryObservations.length} observations to ${output}.`,
);
