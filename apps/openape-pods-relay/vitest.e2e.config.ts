import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { environment: 'node', include: ['e2e/**/*.test.ts'], fileParallelism: false, hookTimeout: 360000, testTimeout: 60000 } })
