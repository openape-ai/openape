import { bundleNpm } from './npm-runtime.mjs'
import { bundleApes } from './apes-runtime.mjs'
import { bundleCodex } from './codex-runtime.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { build as buildScripts } from 'tsup'
import { build as buildRenderer } from 'vite'

await buildScripts({ entry: { 'main/app': 'src/main/app.ts', 'preload/index': 'src/preload/index.ts', 'worker/entry': 'src/worker/entry.ts' }, format: ['cjs'], platform: 'node', target: 'node24', outDir: 'dist', clean: true, splitting: false, removeNodeProtocol: false, external: ['electron'], noExternal: ['croner', '@openape/pods-protocol'], outExtension: () => ({ js: '.cjs' }) })
if (process.platform === 'darwin') {
  mkdirSync('dist/native', { recursive: true })
  execFileSync('/usr/bin/xcrun', ['clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', 'native/pods-helper.c', '-o', 'dist/native/pods-helper'], { stdio: 'inherit' })
}
const podsVersion = `${JSON.parse(readFileSync('package.json', 'utf8')).version}+${execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim()}`
await buildScripts({ entry: { 'runtime/shell-client': 'src/runtime/shell-client.ts', 'runtime/codex-mcp': 'src/runtime/codex-mcp.ts', 'runtime/script-entry': 'src/worker/runs/script-entry.ts', 'runtime/sdk-host': 'src/worker/agent/sdk-host.ts', 'runtime/master-host': 'src/worker/master/host.ts', 'runtime/auth-host': 'src/main/connections/auth-host.ts' }, format: ['esm'], platform: 'node', target: 'node24', outDir: 'dist', clean: false, splitting: false, removeNodeProtocol: false, noExternal: ['@openai/codex-sdk', 'croner'], define: { __OPENAPE_PODS_VERSION__: JSON.stringify(podsVersion) }, outExtension: () => ({ js: '.mjs' }) })
await buildScripts({ entry: { 'runtime/mail-parser': 'src/worker/mail/parsers/entry.ts' }, format: ['esm'], platform: 'node', target: 'node24', outDir: 'dist', clean: false, splitting: false, removeNodeProtocol: false, noExternal: ['pdfjs-dist', 'html-to-text', 'fflate'], outExtension: () => ({ js: '.mjs' }) })
copyFileSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'dist/runtime/pdf.worker.mjs')
const parserHash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
writeFileSync('dist/runtime/parser-manifest.json', JSON.stringify({ entry: parserHash('dist/runtime/mail-parser.mjs'), worker: parserHash('dist/runtime/pdf.worker.mjs') }))
bundleCodex()
bundleNpm()

await bundleApes()
copyFileSync('runtime-sources/pod-http-shapes.toml', 'dist/vendor/pod-http-shapes.toml')
copyFileSync('runtime-sources/pod-runtime-shapes.toml', 'dist/vendor/pod-runtime-shapes.toml')
await buildRenderer()

writeFileSync('dist/build-inputs.json', JSON.stringify({ sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), clean: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '', dependencyLockHash: createHash('sha256').update(readFileSync('../../pnpm-lock.yaml')).digest('hex') }, null, 2))
