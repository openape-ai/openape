import { defineConfig } from 'vitest/config'

export default defineConfig({
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
