import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Every Vitest file starts inside a disposable profile. Individual tests may
// replace these paths, but their "original" value is always this sandbox—not a
// developer's real ~/.loadout or agent configuration.
const sandbox = mkdtempSync(join(tmpdir(), "loadout-vitest-"));
process.env.LOADOUT_HOME = join(sandbox, ".loadout");
process.env.LOADOUT_USER_HOME = join(sandbox, "user-home");
mkdirSync(process.env.LOADOUT_HOME, { recursive: true });
mkdirSync(process.env.LOADOUT_USER_HOME, { recursive: true });

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));
