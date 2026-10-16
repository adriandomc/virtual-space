import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/setup.ts',
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    locale: 'es-MX',
    baseURL: 'http://127.0.0.1:5188',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'chromium', testIgnore: /gpu\.spec\.ts/, use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL, launchOptions: { args: ['--disable-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
    { name: 'webkit', testIgnore: /gpu\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    { name: 'gpu', testMatch: /gpu\.spec\.ts/, use: { ...devices['Desktop Chrome'], channel: 'chrome', launchOptions: { args: [] } } },
  ],
});
