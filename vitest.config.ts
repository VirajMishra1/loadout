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
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      // Measure the product, not the harness or the generated output.
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/**/*.d.ts"],
      // Floors set to measured coverage at the time of writing. They ratchet
      // upward only: raise them as coverage improves, never lower them to make
      // a red build pass.
      thresholds: {
        lines: 72,
        functions: 77,
        statements: 71,
        branches: 62,
        // Security-critical paths carry a higher bar and already meet it.
        "src/core/catalog/safety.ts": {
          lines: 92,
          functions: 100,
          statements: 91,
          branches: 82,
        },
        "src/core/catalog/registry.ts": {
          lines: 74,
          functions: 95,
          statements: 73,
          branches: 67,
        },
      },
    },
  },
});
