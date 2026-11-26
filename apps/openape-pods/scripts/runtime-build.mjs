import { bundleNpm } from './npm-runtime.mjs'
import { bundleApes } from './apes-runtime.mjs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { build as buildScripts } from 'tsup'

export async function buildRuntimeAssets() {
  if (process.platform === 'darwin') {
    mkdirSync('dist/native', { recursive: true })
    execFileSync('/usr/bin/xcrun', ['clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', 'native/pods-helper.c', '-o', 'dist/native/pods-helper'], { stdio: 'inherit' })
  }
  const podsVersion = `${JSON.parse(readFileSync('package.json', 'utf8')).version}+${execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim()}`
  await buildScripts({ entry: { 'runtime/shell-client': 'src/runtime/shell-client.ts', 'runtime/program-client': 'src/runtime/program-client.ts', 'runtime/codex-mcp': 'src/runtime/codex-mcp.ts', 'runtime/script-entry': 'src/worker/runs/script-entry.ts' }, format: ['esm'], platform: 'node', target: 'node24', outDir: 'dist', clean: false, splitting: false, removeNodeProtocol: false, define: { __OPENAPE_PODS_VERSION__: JSON.stringify(podsVersion) }, outExtension: () => ({ js: '.mjs' }) })
  // Script dependency hashes bind to this build's lockfile.
  writeFileSync('dist/runtime/manifest.json', JSON.stringify({ dependencyLockHash: createHash('sha256').update(readFileSync('../../pnpm-lock.yaml')).digest('hex') }, null, 2))
  bundleNpm()

  await bundleApes()
}
