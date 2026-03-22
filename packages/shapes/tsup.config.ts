import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  sourcemap: true,
  dts: true,
  define: {
    __VERSION__: JSON.stringify(version),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
})
