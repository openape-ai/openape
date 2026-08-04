import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Component tests mount .vue files; the plugin compiles them. Server-side
  // tests are unaffected (they run in the default node environment).
  plugins: [vue()],
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    testTimeout: 15000,
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
    },
  },
})
