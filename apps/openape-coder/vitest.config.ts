import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Store utils import useDb → useRuntimeConfig from nitropack/runtime at
      // module load. Tests inject their own db and never call useDb, so a stub
      // is enough to make the import resolvable under plain vitest.
      'nitropack/runtime': fileURLToPath(new URL('./tests/stubs/nitropack-runtime.ts', import.meta.url)),
    },
  },
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    testTimeout: 15000,
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
    },
  },
})
