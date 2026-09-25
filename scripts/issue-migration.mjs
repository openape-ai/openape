#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportSource, digest } from './native-issues/export.mjs'
import { makeManifest, readJson } from './native-issues/manifest.mjs'
import { applyBundle, loadBundle, removeBatch, validateTarget } from './native-issues/import.mjs'

export async function execute(args) {
  const [command = 'help', ...rest] = args
  if (command === 'help' || command === '--help') return { commands: ['export --source ORIGIN --repository OWNER/NAME --output DIRECTORY', 'prepare --snapshot DIRECTORY --mapping FILE --history FILE --output DIRECTORY', 'validate|dry-run --bundle DIRECTORY [--database ABSOLUTE_PATH --assets ABSOLUTE_DIRECTORY]', 'apply|remove --bundle DIRECTORY --database ABSOLUTE_PATH --assets ABSOLUTE_DIRECTORY --destination REPO_ID --approval FILE [--production]'], default: 'read-only; no production endpoint or automatic synchronization', token: 'FORGEJO_TOKEN is used only by export' }
  const flags = {}; const allowed = new Set(['source', 'repository', 'output', 'snapshot', 'mapping', 'history', 'bundle', 'database', 'assets', 'destination', 'approval', 'production'])
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index].slice(2)
    if (!rest[index].startsWith('--') || !allowed.has(key) || flags[key] !== undefined) throw new Error('Unknown or duplicate option')
    if (key === 'production') { flags[key] = true; continue }
    if (!rest[index + 1] || rest[index + 1].startsWith('--')) throw new Error(`Missing value: ${key}`)
    flags[key] = rest[++index]
  }
  const required = (...keys) => {
    for (const key of keys) {
      if (!flags[key]) throw new Error(`Missing --${key}`)
    }
  }
  if (command === 'export') {
    required('source', 'repository', 'output')
    return exportSource({ source: flags.source, repository: flags.repository, output: resolve(flags.output), token: process.env.FORGEJO_TOKEN })
  }
  if (command === 'prepare') {
    required('snapshot', 'mapping', 'history', 'output')
    const snapshot = readJson(join(flags.snapshot, 'snapshot.json')); const mapping = readJson(flags.mapping); const history = readJson(flags.history)
    const manifest = makeManifest(snapshot, mapping, history)
    const output = resolve(flags.output); mkdirSync(output, { mode: 0o700 }); mkdirSync(join(output, 'assets'), { mode: 0o700 })
    for (const [name, value] of Object.entries({ snapshot, mapping, history, manifest })) writeFileSync(join(output, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    for (const asset of manifest.assets) copyFileSync(join(flags.snapshot, 'assets', asset.sha256), join(output, 'assets', asset.sha256))
    loadBundle(output)
    return { ok: true, manifestHash: digest(manifest), destination: manifest.destination, counts: { issues: manifest.issues.length, comments: manifest.comments.length, attachments: manifest.assets.length }, exceptions: manifest.exceptions }
  }
  required('bundle')
  const bundle = loadBundle(flags.bundle)
  if (['validate', 'dry-run'].includes(command)) {
    if (!flags.database) return { ok: !bundle.manifest.exceptions.some(item => item.blocking), manifestHash: bundle.hash, writeReady: !bundle.manifest.exceptions.some(item => item.blocking || !item.disposition), exceptions: bundle.manifest.exceptions }
    required('assets')
    const db = new DatabaseSync(flags.database, { readOnly: true })
    try { return validateTarget(db, bundle.manifest, resolve(flags.assets)) }
    finally { db.close() }
  }
  if (!['apply', 'remove'].includes(command)) throw new Error('Unknown command; use --help')
  required('database', 'assets', 'destination', 'approval')
  if (flags.destination !== bundle.manifest.destination.id) throw new Error('Explicit destination does not match the manifest')
  const options = { database: flags.database, assetsDirectory: flags.assets, approval: readJson(flags.approval), production: flags.production === true }
  return command === 'apply' ? applyBundle(bundle, options) : removeBatch(bundle, options)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await execute(process.argv.slice(2)); console.log(JSON.stringify(result, null, 2)); if (result.ok === false) process.exitCode = 1 }
  catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1 }
}
