#!/usr/bin/env node
// Tested-image prod deploy: the Mac builds + smoke-tests app images, pushes
// them to registry.openape.ai, and chatty pulls + restarts the containers —
// with an /api/health gate and tag rollback. No build on chatty.
//
//   pnpm run deploy:image <target...>     # free-idp | troop | chat | …
//   pnpm run deploy:image --all
//
// PARALLEL flow (matters for multi-target / --all):
//   1. guard   — all targets' systemd units must be inactive (one ssh)
//   2. build   — ALL targets in one `turbo run build` wave (parallel)
//   3. bake    — per target, concurrently: package amd64 image → smoke
//                (/api/health, dummy env) → push. NO prod touch yet, so a
//                failure here aborts before anything is swapped.
//   4. swap    — sync compose/chatty.yml, pin every tag in
//                /home/openape/prod/.env (keeping <APP>_TAG_PREV), then ONE
//                `compose up` for all targets at once.
//   5. gate    — external /api/health per target in parallel; any that fail
//                are individually rolled back to their PREV tag.
//
// One-time cutover guard: refuses to deploy while a target's systemd unit is
// still active (port conflict) — stop + disable it first; it stays as the
// dormant fallback.

import { execFileSync } from 'node:child_process'
import process from 'node:process'

const REGISTRY = 'registry.openape.ai'
const HOST = process.env.CHATTY_HOST || 'chatty.delta-mind.at'
const USER = process.env.CHATTY_USER || 'openape'
const PROD_DIR = '/home/openape/prod'

const TARGETS = {
  'free-idp': { filter: 'openape-free-idp', dir: 'apps/openape-free-idp', image: 'openape-free-idp', port: 3003, compose: 'idp', unit: 'openape-free-idp', domain: 'id.openape.ai', envVar: 'IDP_TAG' },
  'troop': { filter: '@openape/troop', dir: 'apps/openape-troop', image: 'openape-troop', port: 3010, compose: 'troop', unit: 'openape-troop', domain: 'troop.openape.ai', envVar: 'TROOP_TAG' },
  'chat': { filter: '@openape/chat', dir: 'apps/openape-chat', image: 'openape-chat', port: 3007, compose: 'chat', unit: 'openape-chat', domain: 'chat.openape.ai', envVar: 'CHAT_TAG' },
  'testrun': { filter: '@openape-testrun/app', dir: 'apps/openape-testrun', image: 'openape-testrun', port: 3006, compose: 'testrun', unit: 'openape-testrun', domain: 'testrun.openape.ai', envVar: 'TESTRUN_TAG' },
  'tasks': { filter: '@openape-tasks/app', dir: 'apps/openape-tasks', image: 'openape-tasks', port: 3005, compose: 'tasks', unit: 'openape-tasks', domain: 'tasks.openape.ai', envVar: 'TASKS_TAG' },
  'pr': { filter: '@openape-pr/app', dir: 'apps/openape-pr', image: 'openape-pr', port: 3014, compose: 'pr', unit: 'openape-pr', domain: 'pr.openape.ai', envVar: 'PR_TAG' },
  'plans': { filter: '@openape-plans/app', dir: 'apps/openape-plans', image: 'openape-plans', port: 3004, compose: 'plans', unit: 'openape-plans', domain: 'plans.openape.ai', envVar: 'PLANS_TAG' },
  'timetrack': { filter: '@openape-timetrack/app', dir: 'apps/openape-timetrack', image: 'openape-timetrack', port: 3011, compose: 'timetrack', unit: 'openape-timetrack', domain: 'timetrack.openape.ai', envVar: 'TIMETRACK_TAG' },
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}
// Quiet variant for the concurrent bake phase — interleaved inherited stdio
// from parallel docker builds is unreadable, so capture instead.
function shQuiet(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
function out(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
}
function ssh(script) {
  return execFileSync('ssh', ['-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', `${USER}@${HOST}`, 'bash', '-s'], {
    input: script,
    encoding: 'utf8',
  }).trim()
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
function tagFor(t, sha) {
  return `${REGISTRY}/${t.image}:prod-${sha}`
}

async function smokeTest(tag, port) {
  const name = `smoke-${port}`
  try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }) }
  catch {}
  shQuiet('docker', [
    'run', '-d', '--rm', '--name', name, '--platform', 'linux/amd64',
    '-p', `127.0.0.1:1${port}:${port}`,
    // Dummy env so apps that hard-require config still boot for /api/health.
    '-e', 'NUXT_OPENAPE_IDP_SESSION_SECRET=smoke-test-session-secret-0000000000',
    '-e', 'NUXT_OPENAPE_SP_SESSION_SECRET=smoke-test-session-secret-0000000000',
    '-e', 'NUXT_TURSO_URL=file:/tmp/smoke.db',
    tag,
  ])
  try {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:1${port}/api/health`)
        if (res.ok && (await res.json()).ok === true)
          return
      }
      catch {}
      await sleep(2000)
    }
    throw new Error(`smoke test failed: /api/health never returned ok on :1${port}`)
  }
  finally {
    try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }) }
    catch {}
  }
}

async function externalHealth(domain) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`https://${domain}/api/health`, { signal: AbortSignal.timeout(8000) })
      if (res.ok && (await res.json()).ok === true)
        return true
    }
    catch {}
    await sleep(3000)
  }
  return false
}

// ── phase 3: bake one image (package → smoke → push), no prod touch ──────────
async function bake(name, sha) {
  const t = TARGETS[name]
  const tag = tagFor(t, sha)
  shQuiet('docker', ['buildx', 'build', '--platform', 'linux/amd64', '-f', 'compose/preview-package.Dockerfile', '--build-arg', `PORT=${t.port}`, '-t', tag, '--load', `${t.dir}/.output`])
  await smokeTest(tag, t.port)
  shQuiet('docker', ['push', tag])
  console.log(`  ✓ baked ${name} (${tag})`)
}

async function main() {
  const args = process.argv.slice(2)
  const names = args.includes('--all') ? Object.keys(TARGETS) : args.filter(a => !a.startsWith('--'))
  if (names.length === 0 || names.some(n => !TARGETS[n])) {
    console.error(`usage: pnpm run deploy:image <${Object.keys(TARGETS).join('|')}>... | --all`)
    process.exit(1)
  }
  const sha = out('git', ['rev-parse', '--short', 'HEAD'])
  const targets = names.map(n => ({ name: n, ...TARGETS[n] }))

  // 1. guard — all units inactive (single ssh)
  const active = ssh(targets.map(t => `echo "${t.name}:$(systemctl is-active ${t.unit} 2>/dev/null || echo inactive)"`).join('\n'))
    .split('\n')
    .filter(l => l.endsWith(':active'))
    .map(l => l.split(':')[0])
  if (active.length) {
    throw new Error(
      `systemd unit(s) still active on chatty: ${active.join(', ')} — one-time cutover needed first:\n${
        active.map(n => `  (as ubuntu) sudo systemctl stop ${TARGETS[n].unit} && sudo systemctl disable ${TARGETS[n].unit}`).join('\n')}`,
    )
  }

  // 2. build — one turbo wave for all targets (parallel)
  console.log(`\n━━━ build (${names.length}) → prod-${sha}`)
  sh('pnpm', ['turbo', 'run', 'build', ...targets.map(t => `--filter=${t.filter}`)])

  // 3. bake — package + smoke + push, concurrently, NO prod touch
  console.log(`\n━━━ bake (package → smoke → push), concurrent`)
  await Promise.all(targets.map(t => bake(t.name, sha)))

  // 4. swap — sync compose, pin all tags (capture PREV), one compose up
  console.log(`\n━━━ swap on chatty (one compose up for all)`)
  sh('scp', ['-q', 'compose/chatty.yml', `${USER}@${HOST}:${PROD_DIR}/docker-compose.yml`])
  const composes = targets.map(t => t.compose).join(' ')
  const pinScript = `
    set -euo pipefail
    cd ${PROD_DIR}
    touch .env
    cp .env .env.bak
${targets.map(t => `    OLD_${t.envVar}=$(grep -E '^${t.envVar}=' .env | cut -d= -f2- || true)
    grep -vE '^${t.envVar}(_PREV)?=' .env > .env.new && mv .env.new .env
    [ -n "$OLD_${t.envVar}" ] && echo "${t.envVar}_PREV=$OLD_${t.envVar}" >> .env
    echo "${t.envVar}=prod-${sha}" >> .env`).join('\n')}
    docker compose --env-file .env -f docker-compose.yml pull -q ${composes}
    docker compose --env-file .env -f docker-compose.yml up -d ${composes}
${targets.map(t => `    echo "PREV ${t.name} $OLD_${t.envVar}"`).join('\n')}
  `
  const prevMap = {}
  for (const line of ssh(pinScript).split('\n')) {
    const m = line.match(/^PREV (\S+) (.*)$/)
    if (m) prevMap[m[1]] = m[2].trim()
  }

  // 5. gate — external health per target in parallel; rollback failures
  console.log(`\n━━━ health gate (parallel)`)
  const results = await Promise.all(targets.map(async t => ({ name: t.name, ok: await externalHealth(t.domain) })))
  for (const r of results.filter(r => r.ok))
    console.log(`  ✓ ${r.name} healthy (prod-${sha}${prevMap[r.name] ? `, prev ${prevMap[r.name]}` : ''})`)

  const failed = results.filter(r => !r.ok).map(r => r.name)
  if (failed.length) {
    console.error(`\n✗ health gate failed: ${failed.join(', ')} — rolling back`)
    const rollScript = `
      set -euo pipefail
      cd ${PROD_DIR}
${failed.map((n) => {
  const t = TARGETS[n]
  const prev = prevMap[n]
  if (!prev) return `      echo "${n}: no previous tag — emergency: (as ubuntu) sudo systemctl start ${t.unit}"`
  return `      grep -vE '^${t.envVar}=' .env > .env.new && mv .env.new .env
      echo "${t.envVar}=${prev}" >> .env`
}).join('\n')}
      docker compose --env-file .env -f docker-compose.yml up -d ${failed.map(n => TARGETS[n].compose).join(' ')}
    `
    ssh(rollScript)
    console.error(`→ rolled back: ${failed.map(n => `${n}→${prevMap[n] || '(none)'}`).join(', ')}`)
    throw new Error(`deploy failed health gate: ${failed.join(', ')}`)
  }

  console.log(`\n✅ deployed via image path: ${names.join(', ')} (prod-${sha})`)
}

await main()
