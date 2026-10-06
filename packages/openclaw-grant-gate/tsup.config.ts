import { defineConfig } from 'tsup'

export default defineConfig({
  // `plugin` is its own entry because OpenClaw loads it directly as the
  // extension (see package.json `openclaw.extensions`); `index` is the
  // library surface consumers and tests import.
  entry: ['src/index.ts', 'src/plugin.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  shims: false,
  dts: true,
  splitting: false,
  sourcemap: false,
})
