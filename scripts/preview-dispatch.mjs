#!/usr/bin/env node
// Per-app PR previews from TESTED images: build only the apps a PR changes,
// push each as registry.openape.ai/<app>:pr-<n>, and let Coolify deploy that
// exact artifact.
//
// Runs on the `mac` runner (fast native builds, warm pnpm/turbo caches). The
// flow per affected app: `turbo run build` → COPY-only amd64 image
// (compose/preview-package.Dockerfile) → push → Coolify
// `POST /deploy?uuid&pr&docker_tag` (for dockerimage apps Coolify upserts the
// ApplicationPreview itself — no webhook needed). `closed` tears every app's
// preview down via `DELETE /applications/<uuid>/previews/<n>` (404 = none).
//
// env: GITHUB_EVENT_PATH   Forgejo Actions event payload
//      GITHUB_BASE_REF     PR base branch
//      COOLIFY_API         default https://coolify.openape.ai/api/v1
//      COOLIFY_TOKEN       deploy-scoped Coolify API token
//      REGISTRY_USER / REGISTRY_PASSWORD   push creds for registry.openape.ai

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const REGISTRY = 'registry.openape.ai'
const API = process.env.COOLIFY_API || 'https://coolify.openape.ai/api/v1'

const APPS = [
  { name: 'idp', dir: 'apps/openape-free-idp/', filter: 'openape-free-idp', image: 'openape-free-idp', port: 3003, uuid: 't13z5yj6xw87cy7bwz00y93x' },
  { name: 'troop', dir: 'apps/openape-troop/', filter: '@openape/troop', image: 'openape-troop', port: 3010, uuid: 'hke1tnc7xxy2pc8uf8ch6bud' },
  { name: 'chat', dir: 'apps/openape-chat/', filter: '@openape/chat', image: 'openape-chat', port: 3007, uuid: 'zmgz7sm50unh49bzclgjbfmh' },
  // org retired (merged into troop, B0) — no preview target.
]

// A change here affects every app's preview image (shared workspace deps and
// the packaging Dockerfile all previews are built with).
const SHARED_PREFIXES = ['packages/', 'modules/']
const SHARED_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'turbo.json', 'compose/preview-package.Dockerfile']

function affectedApps(changedFiles) {
  const touchesShared = changedFiles.some(f =>
    SHARED_PREFIXES.some(p => f.startsWith(p)) || SHARED_FILES.includes(f),
  )
  if (touchesShared)
    return APPS
  return APPS.filter(app => changedFiles.some(f => f.startsWith(app.dir)))
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Coolify API call with an explicit timeout + retries. The build/push of each
// app succeeds well before this; a transient network blip or a busy Coolify
// (ETIMEDOUT / 5xx) on the deploy call must NOT fail the whole preview after
// the image is already in the registry. Never throws — returns {status:0} on
// exhausted retries so the caller can mark the app failed and move on.
async function coolify(method, path, { tries = 4, timeoutMs = 30_000 } = {}) {
  let last = ''
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${process.env.COOLIFY_TOKEN}` },
        signal: ctl.signal,
      })
      const text = await res.text()
      clearTimeout(timer)
      if (res.status >= 500 && attempt < tries) {
        console.log(`[preview] coolify ${method} ${path} → HTTP ${res.status}, retry ${attempt}/${tries}`)
        await sleep(2000 * attempt)
        continue
      }
      return { status: res.status, text }
    }
    catch (err) {
      clearTimeout(timer)
      last = err?.cause?.code ?? err?.message ?? String(err)
      console.log(`[preview] coolify ${method} ${path} attempt ${attempt}/${tries} failed: ${last}`)
      if (attempt < tries) await sleep(2000 * attempt)
    }
  }
  return { status: 0, text: `coolify request failed after ${tries} attempts: ${last}` }
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const action = event.action === 'synchronized' ? 'synchronize' : event.action
const pr = event.number
if (!pr) {
  console.log('[preview] no PR number in event — nothing to do')
  process.exit(0)
}

if (action === 'closed') {
  // Teardown for every app — apps without a preview answer 404, which is fine.
  let failed = false
  for (const app of APPS) {
    const { status, text } = await coolify('DELETE', `/applications/${app.uuid}/previews/${pr}`)
    const ok = status === 200 || status === 404
    console.log(`[preview] ${app.name}: teardown HTTP ${status}${ok ? '' : ` — ${text.slice(0, 200)}`}`)
    if (!ok)
      failed = true
  }
  process.exit(failed ? 1 : 0)
}

if (!['opened', 'synchronize', 'reopened'].includes(action)) {
  console.log(`[preview] action '${event.action}' needs no dispatch`)
  process.exit(0)
}

const base = process.env.GITHUB_BASE_REF || 'main'
const changed = execFileSync('git', ['diff', '--name-only', `origin/${base}...HEAD`], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
const targets = affectedApps(changed)
console.log(`[preview] ${changed.length} changed files → apps: ${targets.map(a => a.name).join(', ') || '(none)'}`)
if (targets.length === 0)
  process.exit(0)

console.log('[preview] pnpm install…')
sh('pnpm', ['install', '--frozen-lockfile'])
sh('docker', ['login', REGISTRY, '-u', process.env.REGISTRY_USER, '--password-stdin'], {
  input: process.env.REGISTRY_PASSWORD,
  stdio: ['pipe', 'inherit', 'inherit'],
})

let failed = false
for (const app of targets) {
  const tag = `${REGISTRY}/${app.image}:pr-${pr}`
  console.log(`\n[preview] ${app.name}: build → ${tag}`)
  sh('pnpm', ['turbo', 'run', 'build', `--filter=${app.filter}`])
  sh('docker', [
    'buildx',
    'build',
    '--platform',
    'linux/amd64',
    '-f',
    'compose/preview-package.Dockerfile',
    '--build-arg',
    `PORT=${app.port}`,
    '-t',
    tag,
    '--push',
    `${app.dir}.output`,
  ])
  const { status, text } = await coolify('POST', `/deploy?uuid=${app.uuid}&pr=${pr}&docker_tag=pr-${pr}`)
  const ok = status === 200 && /queued/i.test(text)
  console.log(`[preview] ${app.name}: deploy HTTP ${status} — ${text.slice(0, 200)}`)
  if (!ok)
    failed = true
}
process.exit(failed ? 1 : 0)
