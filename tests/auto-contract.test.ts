import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectContracts } from "../src/core/coordination/auto-contract.js";
import {
  claimOwnership,
  publishContract,
} from "../src/core/coordination/coordinator.js";

describe("auto-contract detection", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-auto-contract-"));
  });

  it("returns empty when no ownership exists", async () => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src/types.ts"),
      "export interface User { id: string; }\n",
    );

    const result = await detectContracts(root);
    expect(result.candidates).toHaveLength(0);
    expect(result.crossBoundaryImports).toHaveLength(0);
  });

  it("detects cross-boundary imports between owned dirs", async () => {
    // Set up files
    await mkdir(join(root, "src/api"), { recursive: true });
    await mkdir(join(root, "src/client"), { recursive: true });

    await writeFile(
      join(root, "src/api/types.ts"),
      [
        "export interface UserResponse { id: string; name: string; }",
        "export type UserId = string;",
        'export const API_VERSION = "v1";',
      ].join("\n"),
    );

    await writeFile(
      join(root, "src/client/user-page.ts"),
      [
        'import { UserResponse, UserId } from "../api/types.js";',
        "",
        "function render(user: UserResponse): void {",
        "  console.log(user);",
        "}",
      ].join("\n"),
    );

    // Set up ownership
    await claimOwnership(root, {
      agent: "claude-code",
      paths: ["src/api"],
      mode: "exclusive",
    });
    await claimOwnership(root, {
      agent: "codex",
      paths: ["src/client"],
      mode: "exclusive",
    });

    const result = await detectContracts(root);

    expect(result.crossBoundaryImports.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);

    const candidate = result.candidates.find(
      (c) => c.sourceFile === "src/api/types.ts",
    );
    expect(candidate).toBeDefined();
    expect(candidate!.sourceAgent).toBe("claude-code");
    expect(candidate!.consumers).toContain("codex");
    expect(candidate!.sharedSymbols.map((s) => s.name)).toContain(
      "UserResponse",
    );
    expect(candidate!.sharedSymbols.map((s) => s.name)).toContain("UserId");
  });

  it("marks candidates covered by existing contracts", async () => {
    await mkdir(join(root, "src/api"), { recursive: true });
    await mkdir(join(root, "src/client"), { recursive: true });

    await writeFile(
      join(root, "src/api/types.ts"),
      "export interface UserResponse { id: string; }\n",
    );
    await writeFile(
      join(root, "src/client/app.ts"),
      'import { UserResponse } from "../api/types.js";\n',
    );

    await claimOwnership(root, {
      agent: "claude-code",
      paths: ["src/api"],
      mode: "exclusive",
    });
    await claimOwnership(root, {
      agent: "codex",
      paths: ["src/client"],
      mode: "exclusive",
    });

    // Publish a contract that covers this
    await publishContract(root, {
      from: "claude-code",
      name: "api-types",
      body: "export interface UserResponse { id: string; }",
      format: "typescript",
    });

    const result = await detectContracts(root);
    const candidate = result.candidates.find((c) => c.name === "api-types");
    expect(candidate).toBeDefined();
    expect(candidate!.existingContract).toBeDefined();
    expect(candidate!.existingContract!.revision).toBe(1);
  });

  it("ignores imports within same ownership boundary", async () => {
    await mkdir(join(root, "src/api"), { recursive: true });

    await writeFile(
      join(root, "src/api/types.ts"),
      "export interface User { id: string; }\n",
    );
    await writeFile(
      join(root, "src/api/handler.ts"),
      'import { User } from "./types.js";\nexport function getUser(): User { return { id: "1" }; }\n',
    );

    await claimOwnership(root, {
      agent: "claude-code",
      paths: ["src/api"],
      mode: "exclusive",
    });

    const result = await detectContracts(root);
    expect(result.crossBoundaryImports).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
  });

  it("scans various export kinds", async () => {
    await mkdir(join(root, "lib"), { recursive: true });
    await mkdir(join(root, "app"), { recursive: true });

    await writeFile(
      join(root, "lib/shared.ts"),
      [
        "export interface Config { port: number; }",
        'export type Mode = "dev" | "prod";',
        "export function start(): void {}",
        'export const VERSION = "1.0";',
        "export class Server {}",
        "export enum Status { Active, Inactive }",
        "export abstract class Base {}",
      ].join("\n"),
    );

    await writeFile(
      join(root, "app/main.ts"),
      'import { Config, Mode, start, VERSION, Server, Status, Base } from "../lib/shared.js";\n',
    );

    await claimOwnership(root, {
      agent: "agent-a",
      paths: ["lib"],
      mode: "exclusive",
    });
    await claimOwnership(root, {
      agent: "agent-b",
      paths: ["app"],
      mode: "exclusive",
    });

    const result = await detectContracts(root);
    const candidate = result.candidates[0];
    expect(candidate).toBeDefined();

    const kinds = candidate.sharedSymbols.map((s) => s.kind);
    expect(kinds).toContain("interface");
    expect(kinds).toContain("type");
    expect(kinds).toContain("function");
    expect(kinds).toContain("const");
    expect(kinds).toContain("class");
    expect(kinds).toContain("enum");
  });

  it("generates contract name from file path", async () => {
    await mkdir(join(root, "src/core/auth"), { recursive: true });
    await mkdir(join(root, "src/web"), { recursive: true });

    await writeFile(
      join(root, "src/core/auth/types.ts"),
      "export interface Token { value: string; }\n",
    );
    await writeFile(
      join(root, "src/web/login.ts"),
      'import { Token } from "../core/auth/types.js";\n',
    );

    await claimOwnership(root, {
      agent: "a",
      paths: ["src/core"],
      mode: "exclusive",
    });
    await claimOwnership(root, {
      agent: "b",
      paths: ["src/web"],
      mode: "exclusive",
    });

    const result = await detectContracts(root);
    expect(result.candidates[0].name).toBe("core-auth-types");
  });

  it("respects scope option to limit scanning", async () => {
    await mkdir(join(root, "src/api"), { recursive: true });
    await mkdir(join(root, "src/client"), { recursive: true });
    await mkdir(join(root, "docs"), { recursive: true });

    await writeFile(
      join(root, "src/api/types.ts"),
      "export interface X { id: string; }\n",
    );
    await writeFile(
      join(root, "src/client/app.ts"),
      'import { X } from "../api/types.js";\n',
    );
    await writeFile(join(root, "docs/guide.ts"), "export const y = 1;\n");

    await claimOwnership(root, {
      agent: "a",
      paths: ["src/api"],
      mode: "exclusive",
    });
    await claimOwnership(root, {
      agent: "b",
      paths: ["src/client"],
      mode: "exclusive",
    });

    const scoped = await detectContracts(root, { scope: ["src"] });
    expect(scoped.filesScanned).toBeGreaterThanOrEqual(2);
    // docs/guide.ts excluded
    const allFiles = scoped.crossBoundaryImports.map((i) => i.importer);
    expect(allFiles).not.toContain("docs/guide.ts");
  });

  it("builds suggested contract body with typed stubs", async () => {
    await mkdir(join(root, "api"), { recursive: true });
    await mkdir(join(root, "web"), { recursive: true });

    await writeFile(
      join(root, "api/schema.ts"),
      [
        "export interface Request { body: string; }",
        "export function validate(r: Request): boolean { return true; }",
      ].join("\n"),
    );
    await writeFile(
      join(root, "web/page.ts"),
      'import { Request, validate } from "../api/schema.js";\n',
    );

    await claimOwnership(root, {
      agent: "a",
      paths: ["api"],
      mode: "exclusive",
    });
    await claimOwnership(root, {
      agent: "b",
      paths: ["web"],
      mode: "exclusive",
    });

    const result = await detectContracts(root);
    const body = result.candidates[0].suggestedBody;
    expect(body).toContain("export interface Request");
    expect(body).toContain("export function validate");
    expect(body).toContain("2 shared export(s)");
  });
});
