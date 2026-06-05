import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
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
