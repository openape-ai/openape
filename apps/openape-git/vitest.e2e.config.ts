import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['e2e/**/*.e2e.test.ts'], environment: 'node', maxWorkers: 1, testTimeout: 120000, hookTimeout: 360000 } })
