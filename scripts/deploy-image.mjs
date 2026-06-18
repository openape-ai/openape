#!/usr/bin/env node
// Tested-image prod deploy: the Mac builds + smoke-tests an app image, pushes
// it to registry.openape.ai, and chatty pulls + restarts the container — with
// an /api/health gate and tag rollback. No build on chatty.
//
//   pnpm run deploy:image <target...>     # free-idp | troop | chat
//   pnpm run deploy:image --all
//
// Flow per target: turbo build (.output, warm cache) → COPY-only amd64 image
// (compose/preview-package.Dockerfile, same artifact format as PR previews,
// tag prod-<shortsha>) → local smoke run (/api/health with dummy env) → push
// → sync compose/chatty.yml to chatty → pin tag in /home/openape/prod/.env
// (keeping <APP>_TAG_PREV for rollback) → compose pull + up → external
// health gate → on failure: revert the pin + up again, exit 1.
//
// One-time cutover guard: refuses to deploy while the app's systemd unit is
// still active (port conflict) — stop + disable it first, it stays as the
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
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts })
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

async function smokeTest(tag, port) {
  const name = `smoke-${port}`
  execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' })
  sh('docker', [
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
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' })
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

async function deploy(name) {
  const t = TARGETS[name]
  const sha = out('git', ['rev-parse', '--short', 'HEAD'])
  const tag = `${REGISTRY}/${t.image}:prod-${sha}`
  console.log(`\n━━━ ${name} → ${tag}`)

  const unitActive = ssh(`systemctl is-active ${t.unit} 2>/dev/null || true`)
  if (unitActive === 'active') {
    throw new Error(
      `systemd unit ${t.unit} is still active on chatty — one-time cutover needed first:\n`
      + `  (as ubuntu) sudo systemctl stop ${t.unit} && sudo systemctl disable ${t.unit}\n`
      + `then re-run this deploy. Emergency fallback stays: sudo systemctl start ${t.unit}.`,
    )
  }

  console.log(`→ build ${t.filter}`)
  sh('pnpm', ['turbo', 'run', 'build', `--filter=${t.filter}`])
  console.log('→ package (amd64, COPY-only)')
  sh('docker', ['buildx', 'build', '--platform', 'linux/amd64', '-f', 'compose/preview-package.Dockerfile', '--build-arg', `PORT=${t.port}`, '-t', tag, '--load', `${t.dir}/.output`])
  console.log('→ smoke test')
  await smokeTest(tag, t.port)
  console.log('→ push')
  sh('docker', ['push', tag])

  console.log('→ chatty: sync compose, pin tag, pull + up')
  sh('scp', ['-q', 'compose/chatty.yml', `${USER}@${HOST}:${PROD_DIR}/docker-compose.yml`])
  const prev = ssh(`
    set -euo pipefail
    cd ${PROD_DIR}
    touch .env
    OLD=$(grep -E '^${t.envVar}=' .env | cut -d= -f2- || true)
    grep -vE '^${t.envVar}(_PREV)?=' .env > .env.new || true
    if [ -n "$OLD" ]; then echo "${t.envVar}_PREV=$OLD" >> .env.new; fi
    echo "${t.envVar}=prod-${sha}" >> .env.new
    mv .env.new .env
    docker compose --env-file .env -f docker-compose.yml pull -q ${t.compose}
    docker compose --env-file .env -f docker-compose.yml up -d ${t.compose}
    echo "$OLD"
  `)

  console.log(`→ health gate https://${t.domain}/api/health`)
  if (await externalHealth(t.domain)) {
    console.log(`✓ ${name} deployed (prod-${sha}${prev ? `, prev ${prev}` : ''})`)
    return
  }

  console.error(`✗ health gate failed — rolling back ${name}`)
  if (prev) {
    ssh(`
      set -euo pipefail
      cd ${PROD_DIR}
      grep -vE '^${t.envVar}=' .env > .env.new || true
      echo "${t.envVar}=${prev}" >> .env.new
      mv .env.new .env
      docker compose --env-file .env -f docker-compose.yml up -d ${t.compose}
    `)
    console.error(`→ rolled back to ${prev}`)
  }
  else {
    console.error(`→ no previous tag — emergency fallback: (as ubuntu) sudo systemctl start ${t.unit}`)
  }
  throw new Error(`${name}: deploy failed health gate`)
}

const args = process.argv.slice(2)
const names = args.includes('--all') ? Object.keys(TARGETS) : args.filter(a => !a.startsWith('--'))
if (names.length === 0 || names.some(n => !TARGETS[n])) {
  console.error(`usage: pnpm run deploy:image <${Object.keys(TARGETS).join('|')}>... | --all`)
  process.exit(1)
}

for (const name of names)
  await deploy(name)
console.log(`\n✅ deployed via image path: ${names.join(', ')}`)
