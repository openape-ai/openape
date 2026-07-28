#!/usr/bin/env node
// Gateway-IaC M2 — reproducible deploy of the LLM gateway from the repo.
//
// Pushes compose/gateway/ (the version-controlled prod config) to chatty
// (/home/openape/prod-llms/), brings the stack up, and gates on the litellm
// readiness endpoint — rolling back to a pre-deploy snapshot if it doesn't come
// back healthy. The gateway is a single point of failure for every agent's LLM
// access, so this script is built to never touch prod by accident and to always
// be recoverable:
//
//   node scripts/deploy-gateway.mjs            # DRY-RUN (default): show the diff, write nothing
//   node scripts/deploy-gateway.mjs --deploy   # really deploy (snapshot → sync → up → health-gate → rollback on fail)
//
// Only the 8 tracked config files are synced. Secrets (.env), the codex auth
// volumes (codex/, codex-dm/) and the build/ context are never touched (no
// --delete, explicit file list). Every --deploy snapshots the current remote
// files into .iac-backups/<ts>/ first.

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
const READINESS = 'http://127.0.0.1:3012/health/readiness'
const HEALTH_TRIES = 20
const HEALTH_DELAY_S = 3

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

const DEPLOY = process.argv.includes('--deploy')
const md5 = buf => createHash('md5').update(buf).digest('hex')
const ssh = (script, opts = {}) =>
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${USER}@${HOST}`, script], { encoding: 'utf8', ...opts })

function remoteMd5s() {
  const out = ssh(`md5sum ${FILES.map(f => `${REMOTE_DIR}/${f}`).join(' ')} 2>/dev/null || true`)
  const map = {}
  for (const line of out.trim().split('\n')) {
    const [hash, path] = line.trim().split(/\s+/)
    if (path) map[path.replace(`${REMOTE_DIR}/`, '')] = hash
  }
  return map
}

function localMd5(f) {
  return md5(readFileSync(join(LOCAL_DIR, f)))
}

// 1. Compare repo ↔ live, print the plan.
let remote
try {
  remote = remoteMd5s()
}
catch (err) {
  console.error(`deploy-gateway: cannot reach ${HOST} (${err instanceof Error ? err.message : String(err)})`)
  process.exit(2)
}

const changed = FILES.filter(f => remote[f] !== localMd5(f))
if (changed.length === 0) {
  console.log(`deploy-gateway: ${HOST} already matches compose/gateway/ — nothing to deploy.`)
  process.exit(0)
}
console.log(`deploy-gateway: ${changed.length} file(s) differ (repo → ${HOST}):`)
for (const f of changed) console.log(`  - ${f}  (${(remote[f] || 'absent').slice(0, 8)} → ${localMd5(f).slice(0, 8)})`)

if (!DEPLOY) {
  console.log('\nDRY-RUN — nothing written. Re-run with --deploy to apply (snapshots remote first, health-gates, rolls back on failure).')
  process.exit(0)
}

// 2. Snapshot the current remote config (recoverable even if everything fails).
console.log(`\ndeploy-gateway: snapshotting current remote config…`)
const ts = ssh(`set -euo pipefail
cd ${REMOTE_DIR}
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p .iac-backups/$ts
for f in ${FILES.join(' ')}; do mkdir -p ".iac-backups/$ts/$(dirname "$f")"; cp -a "$f" ".iac-backups/$ts/$f"; done
echo $ts`).trim()
console.log(`  snapshot: ${REMOTE_DIR}/.iac-backups/${ts}/`)

// 3. Sync the 8 tracked files (tar over ssh — explicit list, no --delete).
console.log('deploy-gateway: syncing config…')
execFileSync('bash', ['-c',
  `tar -cf - -C '${LOCAL_DIR}' ${FILES.map(f => `'${f}'`).join(' ')} | ssh -o BatchMode=yes ${USER}@${HOST} 'tar -xf - -C ${REMOTE_DIR}'`,
], { stdio: 'inherit' })

// 4. Bring the stack up. --force-recreate so a changed *mounted* config file
// (litellm-config.yaml / ddisa_auth.py) is actually reloaded — plain `up -d`
// only recreates on a service-definition change, so a pure config edit would
// silently keep running the old config. --remove-orphans drops services that
// were removed from the compose file (e.g. a retired account's proxy).
console.log('deploy-gateway: docker compose up -d --force-recreate --remove-orphans…')
ssh(`set -euo pipefail; cd ${REMOTE_DIR} && docker compose up -d --force-recreate --remove-orphans`, { stdio: 'inherit' })

// 5. Health-gate on litellm readiness.
function healthy() {
  for (let i = 1; i <= HEALTH_TRIES; i++) {
    const code = ssh(`curl -s -o /dev/null -w '%{http_code}' --max-time 5 ${READINESS} || true`).trim()
    if (code === '200') {
      console.log(`deploy-gateway: readiness 200 (try ${i}/${HEALTH_TRIES})`)
      return true
    }
    console.log(`  readiness ${code || 'no-response'} (try ${i}/${HEALTH_TRIES}) — waiting ${HEALTH_DELAY_S}s`)
    execFileSync('sleep', [String(HEALTH_DELAY_S)])
  }
  return false
}

if (healthy()) {
  console.log(`\ndeploy-gateway: ✅ deployed + healthy. Snapshot kept at ${REMOTE_DIR}/.iac-backups/${ts}/`)
  process.exit(0)
}

// 6. Rollback.
console.error('\ndeploy-gateway: ❌ unhealthy after deploy — rolling back to snapshot…')
ssh(`set -euo pipefail
cd ${REMOTE_DIR}
for f in ${FILES.join(' ')}; do cp -a ".iac-backups/${ts}/$f" "$f"; done
docker compose up -d --force-recreate --remove-orphans`, { stdio: 'inherit' })
const recovered = ssh(`curl -s -o /dev/null -w '%{http_code}' --max-time 5 ${READINESS} || true`).trim()
console.error(`deploy-gateway: rolled back (post-rollback readiness ${recovered}). Investigate before retrying.`)
process.exit(1)
