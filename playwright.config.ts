import { defineConfig, devices } from "@playwright/test";

const testPort = Number(process.env.PLAYWRIGHT_PORT ?? "3100");
const testBaseUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: testBaseUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `PRAVA_MODE=replay REPLAY_MUTATIONS_ENABLED=true PAYMENTS_ENABLED=false ALLOW_PRAVA_SESSION_CREATION=false ALLOW_PRAVA_LIVE_ORDER=false npm run dev -- --hostname 127.0.0.1 --port ${testPort}`,
    url: testBaseUrl,
    reuseExistingServer: false,
  },
});
