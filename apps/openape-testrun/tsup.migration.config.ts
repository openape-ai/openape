import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'plans-migration': 'scripts/plans-migration.ts' },
  outDir: '.output/server',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: false,
  splitting: false,
  dts: false,
  noExternal: ['@openape/report-contracts'],
  outExtension: () => ({ js: '.mjs' }),
})
