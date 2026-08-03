import { defineConfig } from 'vitest/config'

// Files that boot a real IdP (`examples/idp` via `nuxt dev`). They run as their
// own project so they go one at a time — nine parallel Nuxt boots starve each
// other and the box. Everything else keeps the default parallelism.
const IDP_BACKED_TESTS = [
  'test/additional.test.ts',
  'test/admin.test.ts',
  'test/commands.test.ts',
  'test/dns-check.test.ts',
  'test/grants-edge.test.ts',
  'test/http.test.ts',
  'test/inprocess.test.ts',
  'test/shapes-adapter-grants.test.ts',
  'test/workflows.test.ts',
]

const shared = {
  environment: 'node' as const,
  // The local pre-push gate runs the whole monorepo via `turbo ... --concurrency=4`,
  // so four package suites saturate the CPU at once. A handful of tests here do real
  // HTTP round-trips to an IdP plus RSA keygen; under that contention a
  // single one can occasionally blow the default 5s budget and fail in isolation
  // (observed: "1 failed / 748 passed", a lone test-body failure — not a hook). retry
  // re-runs only the failing test body (suite hooks are untouched), so a transient
  // timeout passes on the second attempt while a genuinely broken test still fails all
  // three. The timeout bump gives headroom so retries are rarely needed.
  retry: 2,
  // 15s still tripped on the loaded CI runner: tests whose vi.mock factory
  // dynamically imports workspace packages (commands-run-async) timed out at
  // exactly 15s while passing locally (run 3222). Same class as hookTimeout.
  testTimeout: 45000,
  // beforeAll in commands.test.ts spawns key setup; the 10s default tripped
  // on the loaded CI runner with coverage on (run 3099: import phase 132s)
  hookTimeout: 180000,
}

export default defineConfig({
  test: {
    projects: [
      {
        test: { ...shared, name: 'unit', include: ['test/**/*.test.ts'], exclude: IDP_BACKED_TESTS },
      },
      {
        test: { ...shared, name: 'idp', include: IDP_BACKED_TESTS, fileParallelism: false },
      },
    ],
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
