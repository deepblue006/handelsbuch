import { defineConfig } from "@playwright/test";
import fs from "node:fs";

// In vorkonfigurierten Umgebungen liegt Chromium unter /opt/pw-browsers; sonst Standard von Playwright.
const preinstalled = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = fs.existsSync(preinstalled) ? preinstalled : undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npx next start -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 120_000 },
});
