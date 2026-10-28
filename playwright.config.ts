import { defineConfig, devices } from '@playwright/test'
import { E2E_PERSIST_DIR } from './tests/e2e/local-d1'

// End-to-end tests run against the built Worker served by `wrangler dev`, so
// they see the same headers, policy and HTML as staging. Run `bun run build`
// first (the `test:e2e` script does this).
const port = Number(process.env.E2E_PORT ?? 8787)
const baseURL = `http://127.0.0.1:${port}`

// Specs that drive the Worker itself rather than a page run once, not per browser.
const workerSpecs = /(deletion-job|body-limits)\.spec\.ts/

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // A service worker's requests can bypass page.route. The site has none
    // yet; adding one on purpose needs an ADR and a deliberate test change.
    serviceWorkers: 'block',
    // Lets a machine with its own Chromium build skip the browser download.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: workerSpecs },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: workerSpecs },
    { name: 'worker', testMatch: workerSpecs },
  ],
  // A fresh local D1 with every migration applied, then the built Worker with
  // the scheduled handler exposed at /__scheduled for the deletion job test.
  webServer: {
    command: [
      `rm -rf ${E2E_PERSIST_DIR}`,
      `bunx wrangler d1 migrations apply DB --local --persist-to ${E2E_PERSIST_DIR}`,
      `bunx wrangler dev --ip 127.0.0.1 --port ${port} --test-scheduled --persist-to ${E2E_PERSIST_DIR}`,
    ].join(' && '),
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
