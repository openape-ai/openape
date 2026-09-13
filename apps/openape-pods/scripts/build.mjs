import { bundleCodex } from './codex-runtime.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { build as buildScripts } from 'tsup'
import { build as buildRenderer } from 'vite'

await buildScripts({ entry: { 'main/app': 'src/main/app.ts', 'preload/index': 'src/preload/index.ts', 'worker/entry': 'src/worker/entry.ts' }, format: ['cjs'], platform: 'node', target: 'node24', outDir: 'dist', clean: true, splitting: false, removeNodeProtocol: false, external: ['electron'], outExtension: () => ({ js: '.cjs' }) })
if (process.platform === 'darwin') {
  mkdirSync('dist/native', { recursive: true })
  execFileSync('/usr/bin/xcrun', ['clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', 'native/pods-helper.c', '-o', 'dist/native/pods-helper'], { stdio: 'inherit' })
}
await buildScripts({ entry: { 'runtime/script-entry': 'src/worker/runs/script-entry.ts', 'runtime/sdk-host': 'src/worker/agent/sdk-host.ts' }, format: ['esm'], platform: 'node', target: 'node24', outDir: 'dist', clean: false, splitting: false, removeNodeProtocol: false, noExternal: ['@openai/codex-sdk'], outExtension: () => ({ js: '.mjs' }) })
bundleCodex()
await buildRenderer()
