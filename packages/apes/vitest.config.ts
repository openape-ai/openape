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
    // beforeAll in commands.test.ts spawns key setup; the 10s default tripped
    // on the loaded CI runner with coverage on (run 3099: import phase 132s)
    hookTimeout: 60000,
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/types/**'],
      reporter: ['text', 'lcov'],
      // ratchet: raise as coverage improves
      thresholds: {
        // Agent-runtime cluster (agent-runtime.ts, agent-tools/, coding/)
        // was extracted into @openape/agent-runtime and its tests moved
        // there. Remaining apes code is mostly CLI command wrappers and
        // shell-out helpers that are integration-tested via dogfood, not
        // unit-tested here. Thresholds adjusted to reflect the new scope.
        // Floors follow the LOWER of mac/linux — platform branches (keychain
        // vs linux paths) make CI-linux measure ~0.5pp below mac (run 3105:
        // lines 53.49, functions 49.77).
        statements: 52,
        functions: 49,
        lines: 53,
      },
    },
  },
})
