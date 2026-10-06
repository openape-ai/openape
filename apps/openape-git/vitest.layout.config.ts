import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['e2e/**/*.layout.test.ts'], environment: 'node', testTimeout: 120000, hookTimeout: 360000 } })
