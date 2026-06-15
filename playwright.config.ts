import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "node tests/e2e/fixture-server.mjs 4173",
      port: 4173,
      reuseExistingServer: false
    },
    {
      command: "node tests/e2e/fixture-server.mjs 4174",
      port: 4174,
      reuseExistingServer: false
    },
    {
      command: "node tests/e2e/fixture-server.mjs 4175 https",
      port: 4175,
      reuseExistingServer: false,
      ignoreHTTPSErrors: true
    }
  ]
});
