import { defineConfig, devices } from "@playwright/test"

// The MVP gate: a full open-mode election on Anvil, driven through the real UI.
// `webServer` boots the whole stack (anvil, deploy, API, worker, Next) via scripts/stack.mjs --e2e.
export default defineConfig({
  testDir: "./e2e",
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node ../../scripts/stack.mjs --e2e",
    url: "http://localhost:3100",
    timeout: process.env.SECVOTE_PROD_WEB === "1" ? 900_000 : 300_000, // a production build takes longer to start
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
})
