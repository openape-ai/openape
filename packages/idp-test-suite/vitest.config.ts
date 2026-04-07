import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/against-server.test.ts'],
    exclude: ['test/against-free-idp.test.ts'],
  },
})
