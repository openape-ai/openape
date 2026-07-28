#!/usr/bin/env node
// Gateway-IaC M3 — drift guard for the LLM gateway config.
//
// compose/gateway/ is the version-controlled copy of the hand-maintained prod
// gateway config on chatty (/home/openape/prod-llms/). This script proves the
// two are still identical: it md5s every tracked file locally and over ssh and
// reports any divergence. Run it before a deploy, or on a schedule, so the repo
// and the live box can't silently drift apart again.
//
//   node scripts/gateway-drift.mjs        # exit 0 = in sync, 1 = drift, 2 = error
//
// Read-only: no writes on either side. Secrets (.env, codex/*) are not tracked
// and not checked.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HOST = process.env.CHATTY_HOST || 'chatty.delta-mind.at'
const USER = process.env.CHATTY_USER || 'openape'
const REMOTE_DIR = '/home/openape/prod-llms'
const LOCAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'compose', 'gateway')

// The tracked config files, relative to both LOCAL_DIR and REMOTE_DIR.
const FILES = [
  'docker-compose.yml',
  'litellm-config.yaml',
  'llm-auth/Dockerfile',
  'llm-auth/ddisa_auth.py',
  'llm-auth/package.json',
  'llm-auth/server.mjs',
  'llm-route/Dockerfile',
  'llm-route/route.mjs',
]

const md5 = buf => createHash('md5').update(buf).digest('hex')

function remoteMd5s() {
  // One ssh round-trip: md5sum every file, parse "<hash>  <path>" lines.
  const remotePaths = FILES.map(f => `${REMOTE_DIR}/${f}`).join(' ')
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${USER}@${HOST}`, `md5sum ${remotePaths}`], { encoding: 'utf8' })
  const map = {}
  for (const line of out.trim().split('\n')) {
    const [hash, path] = line.trim().split(/\s+/)
    if (path) map[path.replace(`${REMOTE_DIR}/`, '')] = hash
  }
  return map
}

let remote
try {
  remote = remoteMd5s()
}
catch (err) {
  console.error(`gateway-drift: cannot read chatty (${err instanceof Error ? err.message : String(err)})`)
  process.exit(2)
}

const drift = []
for (const f of FILES) {
  let local
  try {
    local = md5(readFileSync(join(LOCAL_DIR, f)))
  }
  catch {
    drift.push(`${f}: missing in repo (compose/gateway/)`)
    continue
  }
  const r = remote[f]
  if (!r) drift.push(`${f}: missing on chatty (${REMOTE_DIR})`)
  else if (r !== local) drift.push(`${f}: DRIFT (repo ${local.slice(0, 8)} != chatty ${r.slice(0, 8)})`)
}

if (drift.length === 0) {
  console.log(`gateway-drift: in sync — ${FILES.length} files identical (repo ↔ ${HOST})`)
  process.exit(0)
}

console.error(`gateway-drift: ${drift.length} file(s) diverged between compose/gateway/ and ${HOST}:${REMOTE_DIR}`)
for (const d of drift) console.error(`  - ${d}`)
console.error('\nReconcile: pull the live files into compose/gateway/ (or deploy the repo copy), then re-run.')
process.exit(1)
