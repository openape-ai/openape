import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// test/layout runs in a real browser (vitest.browser.config.ts), not in happy-dom.
export default defineConfig({ plugins: [vue()], test: { include: ['test/**/*.test.ts'], exclude: ['test/layout/**'], environment: 'happy-dom', retry: 0 } })
