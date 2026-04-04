import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    // Nitro's tsconfig extends .nitro/types/tsconfig.json which only exists
    // after `nitro prepare`. Supply a minimal raw config so vitest's esbuild
    // transform doesn't try to resolve the project tsconfig.
    tsconfigRaw: '{}',
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
