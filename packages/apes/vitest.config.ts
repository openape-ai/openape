import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // The local pre-push gate runs the whole monorepo via `turbo ... --concurrency=4`,
    // so four package suites saturate the CPU at once. A handful of tests here do real
    // HTTP round-trips to an in-process IdP plus RSA keygen; under that contention a
    // single one can occasionally blow the default 5s budget and fail in isolation
    // (observed: "1 failed / 748 passed", a lone test-body failure — not a hook). retry
    // re-runs only the failing test body (suite hooks are untouched), so a transient
    // timeout passes on the second attempt while a genuinely broken test still fails all
    // three. The timeout bump gives headroom so retries are rarely needed.
    retry: 2,
    testTimeout: 15000,
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/types/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        // Agent-runtime cluster (agent-runtime.ts, agent-tools/, coding/)
        // was extracted into @openape/agent-runtime and its tests moved
        // there. Remaining apes code is mostly CLI command wrappers and
        // shell-out helpers that are integration-tested via dogfood, not
        // unit-tested here. Thresholds adjusted to reflect the new scope.
        statements: 45,
        functions: 45,
        lines: 45,
      },
    },
  },
})
