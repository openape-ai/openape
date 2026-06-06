import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  shims: false,
  dts: true,
  splitting: false,
  sourcemap: false,
})
