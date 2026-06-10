#!/usr/bin/env node
// Per-app PR previews: trigger Coolify preview deploys for ONLY the apps a
// PR actually changes.
//
// Why this exists: Coolify's gitea webhook handler runs the whole preview
// lifecycle natively (create + FQDN on open, redeploy on sync, teardown on
// close), but its pull_request path ignores watch_paths — pointing the repo
// webhook straight at Coolify previews EVERY app on EVERY PR. So CI runs this
// script on pull_request events instead: it computes the affected apps from
// the git diff and re-signs the event payload with each affected app's own
// Coolify webhook secret. Coolify authenticates a payload per app (HMAC
// against that app's manual_webhook_secret_gitea), so only the apps we sign
// for act — the rest of the lifecycle stays native Coolify.
//
// env: GITHUB_EVENT_PATH            Forgejo Actions event payload (the
//                                   pull_request webhook payload verbatim)
//      GITHUB_BASE_REF              PR base branch
//      COOLIFY_WEBHOOK_URL          Coolify's gitea manual-webhook endpoint
//      COOLIFY_PREVIEW_SECRET_IDP / _TROOP / _CHAT
//                                   per-app secrets (Forgejo Actions secrets)

import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const APPS = [
  { name: 'idp', dir: 'apps/openape-free-idp/', secretEnv: 'COOLIFY_PREVIEW_SECRET_IDP' },
  { name: 'troop', dir: 'apps/openape-troop/', secretEnv: 'COOLIFY_PREVIEW_SECRET_TROOP' },
  { name: 'chat', dir: 'apps/openape-chat/', secretEnv: 'COOLIFY_PREVIEW_SECRET_CHAT' },
  { name: 'org', dir: 'apps/openape-org/', secretEnv: 'COOLIFY_PREVIEW_SECRET_ORG' },
]

// A change here affects every app's preview image (shared workspace deps and
// the parameterized Dockerfile all previews build from).
const SHARED_PREFIXES = ['packages/', 'modules/']
const SHARED_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'turbo.json', 'compose/Nuxt.Dockerfile']

function affectedApps(changedFiles) {
  const touchesShared = changedFiles.some(f =>
    SHARED_PREFIXES.some(p => f.startsWith(p)) || SHARED_FILES.includes(f),
  )
  if (touchesShared)
    return APPS
  return APPS.filter(app => changedFiles.some(f => f.startsWith(app.dir)))
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
// Coolify's handler expects gitea's action name; Actions may report the
// GitHub-compatible alias.
const action = event.action === 'synchronize' ? 'synchronized' : event.action
if (!['opened', 'synchronized', 'reopened', 'closed'].includes(action)) {
  console.log(`[preview] action '${event.action}' needs no dispatch`)
  process.exit(0)
}

let targets
if (action === 'closed') {
  // Teardown is idempotent — apps without a preview answer
  // "No preview deployment found".
  targets = APPS
}
else {
  const base = process.env.GITHUB_BASE_REF || 'main'
  const changed = execFileSync('git', ['diff', '--name-only', `origin/${base}...HEAD`], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  targets = affectedApps(changed)
  console.log(`[preview] ${changed.length} changed files → apps: ${targets.map(a => a.name).join(', ') || '(none)'}`)
}

const body = JSON.stringify({ ...event, action })
let failed = false
for (const app of targets) {
  const secret = process.env[app.secretEnv]
  if (!secret) {
    console.error(`[preview] ${app.name}: secret ${app.secretEnv} is not set`)
    failed = true
    continue
  }
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  const res = await fetch(process.env.COOLIFY_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitea-Event': 'pull_request',
      'X-Gitea-Delivery': randomUUID(),
      'X-Hub-Signature-256': `sha256=${signature}`,
    },
    body,
  })
  const text = await res.text()
  // Coolify's response lists every app matching the repo; only the app we
  // signed for authenticates — the others appear as failed entries, which is
  // expected and not ours to judge.
  let mine
  try {
    mine = JSON.parse(text).find(e => e.application === app.name || e.application_name === app.name)
  }
  catch {}
  const ok = res.status === 200 && mine
    && (mine.status !== 'failed' || /no preview deployment found/i.test(mine.message ?? ''))
  console.log(`[preview] ${app.name}: HTTP ${res.status} — ${mine ? `${mine.status ?? ''} ${mine.message ?? ''}`.trim() : text.slice(0, 200)}`)
  if (!ok)
    failed = true
}
if (failed)
  process.exit(1)
