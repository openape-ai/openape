import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'tests/**/*.test.ts'],
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages.
    retry: 2,
    testTimeout: 15000,
    globals: true,
    environment: 'node',
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' },
    },
  },
})
