import { defineConfig } from "@playwright/test";
import fs from "node:fs";

// In vorkonfigurierten Umgebungen liegt Chromium unter /opt/pw-browsers; sonst Standard von Playwright.
const preinstalled = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = fs.existsSync(preinstalled) ? preinstalled : undefined;
const dbUrl = process.env.E2E_DATABASE_URL ?? "";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:3200",
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: "npx next start -p 3200",
    url: "http://localhost:3200",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: dbUrl, NODE_ENV: "production" },
  },
});
