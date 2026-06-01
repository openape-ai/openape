import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // No library export — this package only ships a bin. Skipping DTS also
  // sidesteps the parallel-build DTS race that packages/apes works around
  // via turbo `cache:false`.
  dts: false,
  splitting: false,
  define: {
    __VERSION__: JSON.stringify(version),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
})
