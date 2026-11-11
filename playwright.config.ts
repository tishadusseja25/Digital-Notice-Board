import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  workers: 1, // the tests share one throwaway server and database
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npx tsx e2e/server.ts",
    url: "http://localhost:4100/api/health",
    timeout: 120_000, // the first run may download the test database
    reuseExistingServer: false,
  },
});
