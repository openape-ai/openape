import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// Component tests opt into happy-dom per file; server and client logic run in Node.
export default defineConfig({ plugins: [vue()], test: { environment: 'node', include: ['test/**/*.test.ts'] } })
