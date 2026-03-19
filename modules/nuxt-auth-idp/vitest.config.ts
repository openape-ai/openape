import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#imports': resolve(__dirname, 'test/mocks/nuxt-imports.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
