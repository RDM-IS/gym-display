import { defineConfig, devices } from "@playwright/test";

// iPad Pro 11" in WebKit, landscape (primary) + portrait. The API is mocked
// per test via page.route, so this never touches production data.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "e2e/.results",
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "ipad-landscape",
      use: { ...devices["iPad Pro 11 landscape"], browserName: "webkit" },
    },
    {
      name: "ipad-portrait",
      use: { ...devices["iPad Pro 11"], browserName: "webkit" },
    },
  ],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/today",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
