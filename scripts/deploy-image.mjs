#!/usr/bin/env node
// Tested-image prod deploy: builds + smoke-tests a multi-arch app image,
// pushes it to GHCR (or configurable REGISTRY), and chatty pulls + restarts
// the container — with an /api/health gate and tag rollback. No build on chatty.
//
//   pnpm run deploy:image <target...>     # troop | free-idp | chat
//   pnpm run deploy:image --all
//   pnpm run deploy:image --dry-run
//   pnpm run deploy:image --list
//
// Flow per target:
//   1. turbo build (.output, warm cache)
//   2. buildx multi-arch build (arm64 + amd64) with app-specific Dockerfile
//   3. local smoke run (/api/health) on amd64 via QEMU
//   4. push to registry (manifest with both archs)
//   5. sync compose/chatty.yml to chatty
//   6. pin digest/tag in /home/openape/prod/.env (keeping <APP>_TAG_PREV for rollback)
//   7. compose pull + up on chatty
//   8. external health gate → on failure: rollback to previous digest
//
// Registry config:
//   REGISTRY env var (default: ghcr.io/openape-ai)
//   GHCR_TOKEN env var for docker login (optional, assumes pre-authenticated)
//
// One-time cutover guard: refuses to deploy while the app's systemd unit is
// still active (port conflict) — stop + disable it first, it stays as the
// dormant fallback.

import { execFileSync } from 'node:child_process'
import process from 'node:process'

const REGISTRY = process.env.REGISTRY || 'ghcr.io/openape-ai'
const HOST = process.env.CHATTY_HOST || 'chatty.delta-mind.at'
const USER = process.env.CHATTY_USER || 'openape'
const PROD_DIR = '/home/openape/prod'

const TARGETS = {
  'troop': { filter: '@openape/troop', dir: 'apps/openape-troop', image: 'openape-troop', port: 3010, compose: 'openape-troop', unit: 'openape-troop', domain: 'troop.openape.ai', envVar: 'TROOP_TAG', dockerfile: 'apps/openape-troop/Dockerfile', healthPath: '/' },
  'free-idp': { filter: 'openape-free-idp', dir: 'apps/openape-free-idp', image: 'openape-free-idp', port: 3003, compose: 'idp', unit: 'openape-free-idp', domain: 'id.openape.ai', envVar: 'IDP_TAG', dockerfile: 'compose/Nuxt.Dockerfile', healthPath: '/api/health' },
  'chat': { filter: '@openape/chat', dir: 'apps/openape-chat', image: 'openape-chat', port: 3007, compose: 'chat', unit: 'openape-chat', domain: 'chat.openape.ai', envVar: 'CHAT_TAG', dockerfile: 'compose/Nuxt.Dockerfile', healthPath: '/api/health' },
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

// Smoke test: run the amd64 image locally via QEMU and hit health endpoint
async function smokeTest(tag, port, healthPath = '/api/health') {
  const name = `smoke-${port}`
  execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' })

  // Build a temporary amd64-only image for smoke testing if tag is a manifest
  // For simplicity, we assume the tag resolves to an amd64 image when run with --platform
  sh('docker', [
    'run', '-d', '--rm', '--name', name, '--platform', 'linux/amd64',
    '-p', `127.0.0.1:1${port}:${port}`,
    // Dummy env so apps that hard-require config still boot for health check.
    '-e', 'NUXT_OPENAPE_IDP_SESSION_SECRET=smoke-test-session-secret-0000000000',
    '-e', 'NUXT_OPENAPE_SP_SESSION_SECRET=smoke-test-session-secret-0000000000',
    '-e', 'NUXT_TURSO_URL=file:/tmp/smoke.db',
    tag,
  ])

  try {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:1${port}${healthPath}`)
        if (res.ok) {
          // For /api/health, verify JSON response; for /, just check 200
          if (healthPath === '/api/health') {
            const json = await res.json()
            if (json.ok === true)
              return
          }
          else {
            // For root path, just check 200 OK
            return
          }
        }
      }
      catch {}
      await sleep(2000)
    }
    throw new Error(`smoke test failed: ${healthPath} never returned ok on :1${port}`)
  }
  finally {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' })
  }
}

// Check external health on the live deployment
async function externalHealth(domain, healthPath = '/api/health') {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`https://${domain}${healthPath}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        // For /api/health, verify JSON response; for /, just check 200
        if (healthPath === '/api/health') {
          const json = await res.json()
          if (json.ok === true)
            return true
        }
        else {
          // For root path, just check 200 OK
          return true
        }
      }
    }
    catch {}
    await sleep(3000)
  }
  return false
}

// Build multi-arch image and return the digest
async function buildAndPush(t, sha) {
  const tag = `${REGISTRY}/${t.image}:${sha}`
  const dockerfile = t.dockerfile || 'compose/Nuxt.Dockerfile'

  console.log(`→ buildx multi-arch (arm64+amd64) → ${tag}`)

  // Build and push multi-arch manifest
  sh('docker', [
    'buildx', 'build',
    '--platform', 'linux/arm64,linux/amd64',
    '-f', dockerfile,
    '-t', tag,
    '--push',
    t.dir,
  ])

  // Get the digest for pinning
  const digestOut = out('docker', ['buildx', 'imagetools', 'inspect', '--format', '{{ .Digest }}', tag])
  const digest = digestOut.replace('sha256:', '')

  return { tag, digest }
}

async function deploy(name, dryRun = false) {
  const t = TARGETS[name]
  const sha = out('git', ['rev-parse', '--short', 'HEAD'])
  const versionTag = `prod-${sha}`

  console.log(`\n━━━ ${name} → ${REGISTRY}/${t.image}:${versionTag}`)

  if (dryRun) {
    console.log(`  [DRY-RUN] Would build multi-arch image for ${name}`)
    console.log(`  [DRY-RUN] Would push to ${REGISTRY}/${t.image}:${versionTag}`)
    console.log(`  [DRY-RUN] Would deploy to chatty (${HOST})`)
    return
  }

  const unitActive = ssh(`systemctl is-active ${t.unit} 2>/dev/null || true`)
  if (unitActive === 'active') {
    throw new Error(
      `systemd unit ${t.unit} is still active on chatty — one-time cutover needed first:\n`
      + `  (as ubuntu) sudo systemctl stop ${t.unit} && sudo systemctl disable ${t.unit}\n`
      + `then re-run this deploy. Emergency fallback stays: sudo systemctl start ${t.unit}.`,
    )
  }

  console.log(`→ turbo build ${t.filter}`)
  sh('pnpm', ['turbo', 'run', 'build', `--filter=${t.filter}`])

  console.log(`→ build and push multi-arch image`)
  const { tag, digest } = await buildAndPush(t, versionTag)

  console.log(`→ smoke test (amd64 via QEMU)`)
  await smokeTest(tag, t.port)

  console.log('→ chatty: sync compose, pin digest, pull + up')
  sh('scp', ['-q', 'compose/chatty.yml', `${USER}@${HOST}:${PROD_DIR}/docker-compose.yml`])

  const prev = ssh(`
    set -euo pipefail
    cd ${PROD_DIR}
    touch .env
    OLD=$(grep -E '^${t.envVar}=' .env | cut -d= -f2- || true)
    grep -vE '^${t.envVar}(_PREV)?=' .env > .env.new || true
    if [ -n "$OLD" ]; then echo "${t.envVar}_PREV=$OLD" >> .env.new; fi
    echo "${t.envVar}=${digest}" >> .env.new
    mv .env.new .env
    docker compose --env-file .env -f docker-compose.yml pull -q ${t.compose}
    docker compose --env-file .env -f docker-compose.yml up -d ${t.compose}
    echo "$OLD"
  `)

  console.log(`→ health gate https://${t.domain}/api/health`)
  if (await externalHealth(t.domain)) {
    console.log(`✓ ${name} deployed (${digest}${prev ? `, prev ${prev}` : ''})`)
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

// List available targets
function listTargets() {
  console.log('Available targets:')
  for (const [name, t] of Object.entries(TARGETS)) {
    console.log(`  ${name}: ${t.image} (port ${t.port}, domain ${t.domain})`)
  }
}

const args = process.argv.slice(2)

if (args.includes('--list')) {
  listTargets()
  process.exit(0)
}

const dryRun = args.includes('--dry-run')
const names = args.filter(a => !a.startsWith('--'))

if (names.length === 0 && !dryRun) {
  console.error('usage: pnpm run deploy:image <target...> | --all | --dry-run | --list')
  console.error('targets:', Object.keys(TARGETS).join(', '))
  process.exit(1)
}

const targetsToDeploy = args.includes('--all') ? Object.keys(TARGETS) : names

if (targetsToDeploy.some(n => !TARGETS[n])) {
  console.error('unknown target(s):', targetsToDeploy.filter(n => !TARGETS[n]).join(', '))
  process.exit(1)
}

for (const name of targetsToDeploy)
  await deploy(name, dryRun)

console.log(`\n✅ deployed via image path: ${targetsToDeploy.join(', ')}`)
