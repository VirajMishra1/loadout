import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSigningKeys, signJsonFile, signPayload, verifyEnvelope, verifyJsonFile } from "../src/core/signing.js";

describe("signed trust evidence", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("signs deterministic catalog data and rejects tampering or the wrong key", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-signing-"));
    const privatePath = join(root, "private.pem"); const publicPath = join(root, "public.pem");
    await generateSigningKeys(privatePath, publicPath);
    const privateKey = await readFile(privatePath, "utf8"); const publicKey = await readFile(publicPath, "utf8");
    const envelope = signPayload([{ id: "demo", metadata: { z: 1, a: 2 } }], privateKey, "2026-01-01T00:00:00.000Z");
    expect(verifyEnvelope(envelope, publicKey).valid).toBe(true);
    expect(verifyEnvelope({ ...envelope, payload: [{ id: "tampered" }] }, publicKey).valid).toBe(false);
    const otherPrivate = join(root, "other-private.pem"); const otherPublic = join(root, "other-public.pem"); await generateSigningKeys(otherPrivate, otherPublic);
    expect(verifyEnvelope(envelope, await readFile(otherPublic, "utf8")).valid).toBe(false);
  });

  it("signs and verifies JSON files without overwriting outputs", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-signing-files-"));
    const privatePath = join(root, "private.pem"); const publicPath = join(root, "public.pem"); await generateSigningKeys(privatePath, publicPath);
    const catalog = join(root, "catalog.json"); const signed = join(root, "catalog.signed.json"); await writeFile(catalog, JSON.stringify([{ id: "demo" }]));
    await signJsonFile(catalog, privatePath, signed); expect((await verifyJsonFile(signed, publicPath)).valid).toBe(true);
    await expect(signJsonFile(catalog, privatePath, signed)).rejects.toThrow();
  });
});
