import { chmodSync } from 'node:fs'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'node22',
  dts: false,
  clean: true,
  sourcemap: true,
  // Make the binary directly executable so the bin entry works without an
  // explicit `node` prefix (npm-installed bin links rely on the +x bit).
  onSuccess: async () => {
    chmodSync('dist/index.js', 0o755)
    chmodSync('dist/index.cjs', 0o755)
  },
})
