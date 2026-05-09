import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  shims: false,
  dts: false,
  sourcemap: false,
  outExtension: () => ({ js: '.mjs' }),
  banner: { js: '#!/usr/bin/env node' },
  // Bundle workspace deps into the published binary so a global
  // install doesn't need transitive `node_modules` for them. External
  // deps (already present at runtime as published npm packages) stay
  // out of the bundle.
  noExternal: [/^@openape\//],
})
