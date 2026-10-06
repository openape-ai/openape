import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Der Komponenten-Test mountet .vue-Dateien; das Plugin kompiliert sie.
  plugins: [vue()],
  // `#shared` is provided by Nuxt in the build; here the alias must be set by hand.
  resolve: {
    alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    include: ['server/**/*.test.ts', 'tests/**/*.test.ts'],
    // CI runs the whole monorepo under load; the 5s default tears there.
    retry: 2,
    testTimeout: 15000,
    globals: true,
    environment: 'node',
  },
})
