#!/usr/bin/env node

/**
 * Tested-image deployer — the Docker counterpart to scripts/deploy.mjs
 * (which is rsync+systemd). Builds a multi-arch image with buildx, pushes
 * it to the registry, pins the pushed tag in the chatty compose project's
 * `.env`, then `pull`s + `up -d`s the service over SSH and health-checks
 * it. On health failure it restores the previous pinned tag and re-ups
 * (rollback).
 *
 * Image delivery is registry-agnostic: REGISTRY defaults to GHCR.
 *
 * Usage:
 *   pnpm deploy:image <target...>        # build+push+deploy (e.g. troop)
 *   pnpm deploy:image troop --dry-run    # print the plan; touch nothing
 *   pnpm deploy:image troop --build-only # build+push, skip the chatty deploy
 *   pnpm deploy:image troop --rollback   # re-up the previous pinned tag
 *   pnpm deploy:image --list             # list known targets
 *
 * Env:
 *   REGISTRY            default ghcr.io/openape-ai
 *   CHATTY_USER         default openape
 *   CHATTY_HOST         default chatty.delta-mind.at
 *   CHATTY_COMPOSE_DIR  default /home/openape/projects/openape-compose
 *
 * Prerequisites (human-gated): `docker login ghcr.io` on the Mac (push)
 * and on chatty (pull); the compose dir on chatty containing chatty.yml +
 * a filled .env.troop. See compose/CHATTY-DOCKER.md.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPTS_DIR, '..')
const SSH_USER = process.env.CHATTY_USER || 'openape'
const SSH_HOST = process.env.CHATTY_HOST || 'chatty.delta-mind.at'
const REGISTRY = process.env.REGISTRY || 'ghcr.io/openape-ai'
const COMPOSE_DIR = process.env.CHATTY_COMPOSE_DIR || '/home/openape/projects/openape-compose'

// One entry per dockerized chatty web app. composeService = the service
// name in compose/chatty.yml; tagVar/prevVar = keys this deployer manages
// in the compose dir's `.env`; healthPath = the 200-always endpoint.
export const TARGETS = {
  troop: {
    app: 'openape-troop',
    dockerfile: 'apps/openape-troop/Dockerfile',
    composeService: 'openape-troop',
    port: 3010,
    tagVar: 'TROOP_TAG',
    prevVar: 'TROOP_TAG_PREV',
    healthPath: '/api/health',
  },
}

export function imageRef(registry, app, tag) {
  return `${registry}/${app}:${tag}`
}

export function parseArgs(argv) {
  const platformArg = argv.find(a => a.startsWith('--platform='))
  return {
    dryRun: argv.includes('--dry-run'),
    list: argv.includes('--list'),
    rollback: argv.includes('--rollback'),
    buildOnly: argv.includes('--build-only'),
    platforms: platformArg ? platformArg.split('=')[1] : 'linux/arm64,linux/amd64',
    targets: argv.filter(a => !a.startsWith('--')),
  }
}

export function digestFromMetadata(metadataJson) {
  try {
    const m = JSON.parse(metadataJson)
    return m['containerimage.digest'] || null
  }
  catch {
    return null
  }
}

function gitSha() {
  return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim()
}

function ssh(remoteCmd) {
  return execFileSync('ssh', ['-l', SSH_USER, SSH_HOST, remoteCmd], { encoding: 'utf-8' }).trim()
}

// Read/update a single KEY=value line in the chatty compose dir's `.env`
// (the interpolation source). Idempotent: replaces or appends the key.
// Returns '' when the key is absent or .env does not exist yet. (An SSH
// failure makes execFileSync throw, which surfaces upstream — not '' here.)
function remoteEnvGet(key) {
  return ssh(`grep -E '^${key}=' ${COMPOSE_DIR}/.env 2>/dev/null | tail -1 | cut -d= -f2- || true`)
}
// Safety assumption: key is a fixed constant (e.g. TROOP_TAG) and value is a
// hex git SHA — both free of shell/sed metacharacters (| & /). If either ever
// comes from user input, replace the sed rewrite with a Python/awk rewrite.
function remoteEnvSet(key, value) {
  ssh(`touch ${COMPOSE_DIR}/.env && (grep -qE '^${key}=' ${COMPOSE_DIR}/.env && sed -i 's|^${key}=.*|${key}=${value}|' ${COMPOSE_DIR}/.env || echo '${key}=${value}' >> ${COMPOSE_DIR}/.env)`)
}

function buildAndPush(t, tag, platforms) {
  const ref = imageRef(REGISTRY, t.app, tag)
  console.log(`  buildx → ${ref}  [${platforms}]`)
  const res = spawnSync('docker', [
    'buildx',
    'build',
    '--platform',
    platforms,
    '-f',
    t.dockerfile,
    '-t',
    ref,
    '--push',
    '--metadata-file',
    '/tmp/deploy-image-meta.json',
    '.',
  ], { cwd: ROOT, stdio: 'inherit', env: process.env })
  if (res.status !== 0)
    throw new Error(`buildx build/push failed (exit ${res.status})`)
  let digest = null
  try {
    digest = digestFromMetadata(execFileSync('cat', ['/tmp/deploy-image-meta.json'], { encoding: 'utf-8' }))
  }
  catch (e) {
    console.warn(`  (could not read buildx metadata: ${e.message})`)
  }
  console.log(`  pushed digest: ${digest || '<unknown>'}`)
  // Digest is audit-only: we pin by git-SHA tag (immutable per build). The
  // digest is logged so it can be recorded in deploy notes if needed.
  return { ref, digest }
}

function composeUp(t) {
  ssh(`cd ${COMPOSE_DIR} && docker compose -f chatty.yml pull ${t.composeService} && docker compose -f chatty.yml up -d --no-build ${t.composeService}`)
}

function healthCheck(t) {
  const cmd = `for i in $(seq 1 20); do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${t.port}${t.healthPath} || echo 000); if [ "$code" = "200" ]; then echo "up ($code)"; exit 0; fi; sleep 1; done; echo "health failed"; exit 1`
  // spawnSync directly (not the ssh() helper): needs stdio:'inherit' to stream
  // and must return a boolean instead of throwing on non-zero exit.
  return spawnSync('ssh', ['-l', SSH_USER, SSH_HOST, cmd], { stdio: 'inherit' }).status === 0
}

function deployTarget(name, opts) {
  const t = TARGETS[name]
  const tag = gitSha()

  if (opts.dryRun) {
    console.log(`\n▶ ${name} (dry run)`)
    console.log(`  would buildx --push ${imageRef(REGISTRY, t.app, tag)} [${opts.platforms}]`)
    console.log(`  would set ${t.prevVar}=<current ${t.tagVar}>, ${t.tagVar}=${tag} in ${SSH_USER}@${SSH_HOST}:${COMPOSE_DIR}/.env`)
    console.log(`  would: cd ${COMPOSE_DIR} && docker compose -f chatty.yml pull ${t.composeService} && up -d --no-build ${t.composeService}`)
    console.log(`  would health-check http://127.0.0.1:${t.port}${t.healthPath}; rollback to ${t.prevVar} on failure`)
    return true
  }

  if (opts.rollback) {
    const prev = remoteEnvGet(t.prevVar)
    if (!prev) {
      console.error(`  no ${t.prevVar} recorded — cannot roll back`)
      return false
    }
    console.log(`  ↩ rolling back ${name} to ${prev}`)
    remoteEnvSet(t.tagVar, prev)
    composeUp(t)
    return healthCheck(t)
  }

  console.log(`\n▶ ${name} → tag ${tag}`)
  buildAndPush(t, tag, opts.platforms)
  if (opts.buildOnly) {
    console.log('  --build-only: skipping chatty deploy')
    return true
  }

  const live = remoteEnvGet(t.tagVar)
  if (live)
    remoteEnvSet(t.prevVar, live)
  remoteEnvSet(t.tagVar, tag)

  composeUp(t)
  if (healthCheck(t)) {
    console.log(`✓ ${name} deployed (${tag})`)
    return true
  }

  console.error(`✗ ${name} unhealthy — rolling back`)
  if (live) {
    remoteEnvSet(t.tagVar, live)
    composeUp(t)
  }
  return false
}

// Only run the CLI entry point when executed directly (not imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.list) {
    console.log('Image deploy targets:')
    for (const n of Object.keys(TARGETS)) console.log(`  ${n}`)
    process.exit(0)
  }

  const unknown = opts.targets.filter(n => !TARGETS[n])
  if (unknown.length) {
    console.error(`Unknown target(s): ${unknown.join(', ')}`)
    console.error(`Known: ${Object.keys(TARGETS).join(', ')}`)
    process.exit(2)
  }
  if (opts.targets.length === 0) {
    console.log('Nothing to deploy. Try --list.')
    process.exit(0)
  }

  let ok = true
  for (const name of opts.targets) {
    try {
      ok = deployTarget(name, opts) && ok
    }
    catch (e) {
      console.error(`✗ ${name} threw: ${e.message}`)
      ok = false
    }
  }
  process.exit(ok ? 0 : 1)
}
