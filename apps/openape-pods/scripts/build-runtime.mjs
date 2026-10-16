import { build } from 'tsup'
import { execFileSync } from 'node:child_process'
import { chmodSync, writeFileSync } from 'node:fs'
import { buildRuntimeAssets } from './runtime-build.mjs'

await build({ entry: { 'worker/entry': 'src/worker/entry.ts' }, format: ['cjs'], platform: 'node', target: 'node24', outDir: 'dist', clean: true, splitting: false, removeNodeProtocol: false, noExternal: [/.*/], outExtension: () => ({ js: '.cjs' }) })
await buildRuntimeAssets()
if (process.platform === 'darwin') {
  for (const name of ['pods-profile-lock']) {
    execFileSync('/usr/bin/xcrun', ['clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', `native/${name}.c`, '-o', `dist/native/${name}`], { stdio: 'inherit' })
  }
}
await build({ entry: { 'cli/entry': 'src/cli/entry.ts' }, format: ['cjs'], platform: 'node', target: 'node24', outDir: 'dist', clean: false, splitting: false, removeNodeProtocol: false, noExternal: [/.*/], banner: { js: '#!/usr/bin/env node' }, outExtension: () => ({ js: '.cjs' }) })
chmodSync('dist/cli/entry.cjs', 0o755)
writeFileSync('dist/cli-build.json', JSON.stringify({ source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.versions.node, platform: process.platform, architecture: process.arch }))
