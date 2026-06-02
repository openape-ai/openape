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
        // M5 added the agent runtime + tool registry. The shared
        // run-loop (lib/agent-runtime.ts) IS unit-tested; the
        // CLI-command wrappers and tool shell-out helpers are
        // integration-tested via M7 dogfood, not here. Bumped
        // functions threshold down to match what we can practically
        // unit-test without ballooning the suite or pretending we
        // mock the LLM provider.
        statements: 50,
        functions: 50,
        lines: 50,
      },
    },
  },
})
