import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts', 'src/reports.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  shims: false,
  dts: false,
  splitting: false,
  noExternal: ['@openape/report-contracts'],
  sourcemap: false,
  outExtension: () => ({ js: '.mjs' }),
  banner: { js: '#!/usr/bin/env node' },
  loader: { '.md': 'text' },
})
