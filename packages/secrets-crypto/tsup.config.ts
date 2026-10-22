import { defineConfig } from 'tsup'

// Runs in the owner's browser, on the server and in the CLI: no Node-only APIs.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  clean: true,
  dts: true,
  splitting: false,
  sourcemap: false,
})
