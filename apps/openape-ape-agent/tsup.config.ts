import { defineConfig } from 'tsup'

const shared = {
  format: ['esm'] as const,
  target: 'node22' as const,
  platform: 'node' as const,
  shims: false,
  splitting: false,
  sourcemap: false,
  outExtension: () => ({ js: '.mjs' as const }),
  // Bundle workspace deps into the published artifact so a global install
  // doesn't need transitive node_modules for them. External deps (already
  // present at runtime as published npm packages) stay out of the bundle.
  noExternal: [/^@openape\//],
}

export default defineConfig([
  {
    // CLI binaries — the shebang banner makes them executable directly.
    ...shared,
    entry: ['src/bridge.ts', 'src/service-bridge-main.ts'],
    clean: true,
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    // Library entrypoint — imported, never executed, so NO shebang banner (a
    // `#!` mid-bundle breaks downstream bundlers). Emits declarations so library
    // consumers (the nest's in-process SessionHost) typecheck against the
    // exported types. clean:false so it doesn't wipe the bin build above.
    ...shared,
    entry: ['src/index.ts'],
    clean: false,
    dts: true,
  },
])
