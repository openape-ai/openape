import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['e2e/**/*.test.ts'], environment: 'node', fileParallelism: false, testTimeout: 45000, hookTimeout: 45000, retry: 0 } })
