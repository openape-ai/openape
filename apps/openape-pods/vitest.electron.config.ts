import { defineConfig } from 'vitest/config'

// Each E2E file owns a disposable fixture root, so files can run concurrently.
// Few files still launch the packaged app (issue 1374), so six workers fit the
// shared 12-core Mac runner: measured 55 s with three, 29 s with five, 25 s with six.
// expect.poll waits 1 s by default; a real PTY answering through ape-shell and
// a grant lookup on the shared runner can take longer without being wrong.
// The handbook screenshot generator is not a check; `pnpm handbook:capture` runs it.
const capture = process.env.PODS_HANDBOOK_CAPTURE === '1'
export default defineConfig({ test: { globalSetup: ['./e2e/o365-setup.ts'], include: capture ? ['e2e/handbook-capture.test.ts'] : ['e2e/**/*.test.ts'], exclude: capture ? [] : ['e2e/handbook-capture.test.ts'], environment: 'node', fileParallelism: true, maxWorkers: 6, testTimeout: 45000, hookTimeout: 45000, retry: 0, expect: { poll: { timeout: 10000 } } } })
