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
  },
});
