import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SignedEnvelope<T> {
  schemaVersion: 1;
  algorithm: "Ed25519";
  createdAt: string;
  publicKeyFingerprint: string;
  payload: T;
  signature: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  throw new Error(`Cannot sign unsupported value type: ${typeof value}`);
}

function fingerprint(publicKey: ReturnType<typeof createPublicKey>): string {
  return `sha256:${createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex")}`;
}

export function signPayload<T>(payload: T, privateKeyPem: string, createdAt = new Date().toISOString()): SignedEnvelope<T> {
  const privateKey = createPrivateKey(privateKeyPem); const publicKey = createPublicKey(privateKey);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Signing key must be Ed25519");
  const message = Buffer.from(canonical({ schemaVersion: 1, algorithm: "Ed25519", createdAt, publicKeyFingerprint: fingerprint(publicKey), payload }));
  return { schemaVersion: 1, algorithm: "Ed25519", createdAt, publicKeyFingerprint: fingerprint(publicKey), payload, signature: sign(null, message, privateKey).toString("base64") };
}

export function verifyEnvelope<T>(envelope: SignedEnvelope<T>, publicKeyPem: string): { valid: boolean; fingerprint: string } {
  if (envelope.schemaVersion !== 1 || envelope.algorithm !== "Ed25519" || typeof envelope.signature !== "string") return { valid: false, fingerprint: "invalid" };
  const publicKey = createPublicKey(publicKeyPem); const keyFingerprint = fingerprint(publicKey);
  if (publicKey.asymmetricKeyType !== "ed25519") return { valid: false, fingerprint: keyFingerprint };
  if (envelope.publicKeyFingerprint !== keyFingerprint) return { valid: false, fingerprint: keyFingerprint };
  const message = Buffer.from(canonical({ schemaVersion: envelope.schemaVersion, algorithm: envelope.algorithm, createdAt: envelope.createdAt, publicKeyFingerprint: envelope.publicKeyFingerprint, payload: envelope.payload }));
  let signature: Buffer; try { signature = Buffer.from(envelope.signature, "base64"); } catch { return { valid: false, fingerprint: keyFingerprint }; }
  return { valid: verify(null, message, publicKey, signature), fingerprint: keyFingerprint };
}

export async function generateSigningKeys(privatePath: string, publicPath: string): Promise<{ privateKey: string; publicKey: string; fingerprint: string }> {
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(); const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = resolve(privatePath); const publicKey = resolve(publicPath);
  await writeFile(privateKey, privatePem, { mode: 0o600, flag: "wx" }); await writeFile(publicKey, publicPem, { mode: 0o644, flag: "wx" });
  return { privateKey, publicKey, fingerprint: fingerprint(pair.publicKey) };
}

export async function signJsonFile(input: string, privateKeyPath: string, output: string): Promise<SignedEnvelope<unknown>> {
  const payload = JSON.parse(await readFile(resolve(input), "utf8")); const privateKey = await readFile(resolve(privateKeyPath), "utf8");
  const envelope = signPayload(payload, privateKey); await writeFile(resolve(output), `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx" }); return envelope;
}

export async function verifyJsonFile(input: string, publicKeyPath: string): Promise<{ valid: boolean; fingerprint: string }> {
  const envelope = JSON.parse(await readFile(resolve(input), "utf8")) as SignedEnvelope<unknown>; const publicKey = await readFile(resolve(publicKeyPath), "utf8");
  return verifyEnvelope(envelope, publicKey);
}
