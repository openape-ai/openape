import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Nuxt's shared/ directory alias — vitest runs outside Nuxt and
      // doesn't know it.
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
    // Server-spawning suites (ssh-key-human-login, yolo-policy, shapes-e2e)
    // bind ephemeral ports and collide under parallelism. Sequential run
    // is still comfortable (~30-60s total).
    fileParallelism: false,
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
