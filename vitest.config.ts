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
      // Floors sit a little below measured coverage: v8 counts differ slightly
      // between platforms and Node versions, and a floor set exactly at the
      // local number fails CI on rounding alone. They ratchet upward only —
      // raise them as coverage improves, never lower them to make a build pass.
      thresholds: {
        lines: 70,
        functions: 75,
        statements: 69,
        branches: 60,
        // Security-critical paths carry a higher bar and already meet it.
        "src/core/catalog/safety.ts": {
          lines: 90,
          functions: 95,
          statements: 89,
          branches: 80,
        },
        "src/core/catalog/registry.ts": {
          lines: 72,
          functions: 90,
          statements: 71,
          branches: 65,
        },
        // Every install module must retain a meaningful individual floor.
        // `source.ts` is currently the limiting file; these values leave
        // cross-platform headroom while preventing an untested install path.
        "src/core/install/**.ts": {
          lines: 48,
          functions: 64,
          statements: 47,
          branches: 52,
        },
      },
    },
  },
});
