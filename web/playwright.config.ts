import { defineConfig, devices } from '@playwright/test';

// Two builds are tested: the local dashboard, with the orchestrator's API answered by
// e2e/api.ts, and the read-only viewer, with a recorded run as its published data.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'npx vite preview --outDir dist-e2e/app --port 4174 --strictPort',
      port: 4174,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx vite preview --outDir dist-e2e/static --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
