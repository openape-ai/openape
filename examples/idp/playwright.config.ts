import { defineConfig } from '@playwright/test'
import { APP_URL, STORAGE_STATE } from './tests/docs/constants'

// Documentation run: the flows under tests/docs double as the source of the
// user manual, so they run serially against one booted app — screenshots have
// to tell a story in order.
export default defineConfig({
  testDir: './tests/docs',
  globalSetup: './tests/docs/global-setup.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: APP_URL,
    storageState: STORAGE_STATE,
  },
})
