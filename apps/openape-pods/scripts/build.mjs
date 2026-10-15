import { buildRuntimeAssets } from './runtime-build.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { build as buildScripts } from 'tsup'
import { build as buildRenderer } from 'vite'

await buildScripts({ entry: { 'main/app': 'src/main/app.ts', 'preload/index': 'src/preload/index.ts', 'worker/entry': 'src/worker/entry.ts' }, format: ['cjs'], platform: 'node', target: 'node24', outDir: 'dist', clean: true, splitting: false, removeNodeProtocol: false, external: ['electron'], noExternal: ['croner', '@openape/pods-protocol', 'electron-updater', 'builder-util-runtime', 'fs-extra', 'lazy-val', 'lodash.escaperegexp', 'lodash.isequal', 'semver', 'tiny-typed-emitter', 'js-yaml', 'argparse', 'sax', 'debug', 'ms', 'graceful-fs', 'universalify', 'jsonfile'], outExtension: () => ({ js: '.cjs' }) })
await buildRuntimeAssets()
await buildRenderer()

writeFileSync('dist/build-inputs.json', JSON.stringify({ sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), clean: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '', dependencyLockHash: createHash('sha256').update(readFileSync('../../pnpm-lock.yaml')).digest('hex') }, null, 2))
