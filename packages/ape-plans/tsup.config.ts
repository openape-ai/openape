import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: true,
    shims: false,
    dts: false,
    splitting: false,
    sourcemap: false,
    outExtension: () => ({ js: '.mjs' }),
    banner: { js: '#!/usr/bin/env node' },
    loader: { '.md': 'text' },
  },
  // Library subpath: `@openape/ape-plans/templates` — consumed by the plans web
  // app so CLI and web editor share one template source. Emits types.
  {
    entry: { templates: 'src/templates/index.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: false,
    dts: true,
    outExtension: () => ({ js: '.mjs' }),
  },
])
