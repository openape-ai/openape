import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// test/layout runs in a real browser (vitest.browser.config.ts), not in happy-dom.
// Several storage and central tests take 2–5 s alone; under the parallel affected run (turbo --concurrency=4)
// the 5 s default times them out (issue 660), so this matches the 15 s the other apps use.
export default defineConfig({ plugins: [vue()], test: { include: ['test/**/*.test.ts'], exclude: ['test/layout/**'], environment: 'happy-dom', retry: 0, testTimeout: 15_000 } })
