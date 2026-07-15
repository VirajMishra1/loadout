import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.LOADOUT_E2E_PORT ?? "4173");
const baseURL = `http://127.0.0.1:${port}`;

/**
 * The browser suite starts a separate dashboard process with an empty,
 * temporary Loadout home. This proves the first-run flow without inspecting or
 * modifying the developer's installed agents or configuration.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "tsx tests/e2e/dashboard-server.ts",
    url: `${baseURL}/api/session`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      LOADOUT_E2E_PORT: String(port),
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
