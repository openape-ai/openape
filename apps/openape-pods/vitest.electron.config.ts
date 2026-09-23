import { defineConfig } from 'vitest/config'

// Each E2E file owns a disposable fixture root, so files can run concurrently.
// Only six files still launch the packaged app (issue 1374), so five workers
// fit the shared 12-core Mac runner: measured 55 s with three, 29 s with five.
// expect.poll waits 1 s by default; a real PTY answering through ape-shell and
// a grant lookup on the shared runner can take longer without being wrong.
export default defineConfig({ test: { globalSetup: ['./e2e/o365-setup.ts'], include: ['e2e/**/*.test.ts'], environment: 'node', fileParallelism: true, maxWorkers: 5, testTimeout: 45000, hookTimeout: 45000, retry: 0, expect: { poll: { timeout: 10000 } } } })
