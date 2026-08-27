import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
    // Atomic filesystem tests are reliable but can exceed Vitest's five-second
    // default on Windows Defender/NTFS. This is not an application SLA.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Several suites spawn the built CLI as a child process. Under full file
    // parallelism those subprocesses starve and time out nondeterministically
    // (a runner artifact, not a product bug). Run files serially so `npm test`
    // is a trustworthy signal; the whole suite still finishes in ~70s.
    fileParallelism: false,
  },
});
