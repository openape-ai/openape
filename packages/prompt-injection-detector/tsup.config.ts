import { defineConfig } from 'tsup'

export default defineConfig({
  // `heuristic` is its own entry so it can be imported browser-side: it is pure
  // (no fs), unlike the barrel `index`, which re-exports audit/config (both fs).
  entry: ['src/index.ts', 'src/heuristic.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  shims: false,
  dts: true,
  splitting: false,
  sourcemap: false,
})
