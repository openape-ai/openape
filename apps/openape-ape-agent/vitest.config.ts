import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace dep from source instead of dist: in CI the
      // tests twice caught packages/apes/dist mid-rewrite (stale chunk hash /
      // missing entry — issue #584). Importing src removes the dist
      // dependency entirely; esbuild compiles the TS on the fly.
      '@openape/apes': fileURLToPath(new URL('../../packages/apes/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    testTimeout: 15000,
  },
})
