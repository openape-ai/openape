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
