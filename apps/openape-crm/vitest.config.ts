import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Der Komponenten-Test mountet .vue-Dateien; das Plugin kompiliert sie.
  plugins: [vue()],
  // `#shared` liefert im Build Nuxt; hier muss der Alias von Hand stehen.
  resolve: {
    alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    include: ['server/**/*.test.ts', 'tests/**/*.test.ts'],
    // CI fährt das ganze Monorepo unter Last; der 5s-Default reißt dort.
    retry: 2,
    testTimeout: 15000,
    globals: true,
    environment: 'node',
  },
})
