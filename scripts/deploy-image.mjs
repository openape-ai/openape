#!/usr/bin/env node
// Tested-image prod deploy: the Mac builds + smoke-tests app images, uploads
// them straight into chatty's image store with `docker pussh` (unregistry,
// only missing layers travel over SSH), and chatty restarts the containers —
// with an /api/health gate and tag rollback. No build on chatty.
//
//   pnpm run deploy:image <target...>     # free-idp | tasks | …
//   pnpm run deploy:image --all
//
// PARALLEL flow (matters for multi-target / --all):
//   1. guard   — all targets' systemd units must be inactive (one ssh)
//   2. build   — ALL targets in one `turbo run build` wave (parallel)
//   3. bake    — per target, concurrently: package amd64 image → smoke
//                (/api/health, dummy env) → pussh. NO prod touch yet, so a
//                failure here aborts before anything is swapped.
//   4. swap    — sync compose/chatty.yml, pin every tag in
//                /home/openape/prod/.env (keeping <APP>_TAG_PREV), then ONE
//                `compose up` for all targets at once.
//   5. gate    — external /api/health per target in parallel; any that fail
//                are individually rolled back to their PREV tag; healthy
//                ones drop local tags other than TAG and TAG_PREV.
//
// One-time cutover guard: refuses to deploy while a target's systemd unit is
// still active (port conflict) — stop + disable it first; it stays as the
// dormant fallback.

import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gitRemotes, repository, resolveTruthRemote } from './repository.mjs'

export { resolveTruthRemote } from './repository.mjs'

// Kept as the local image name prefix only: compose files and the .env tag
// pins on chatty reference `registry.openape.ai/<image>:<tag>`; nothing is
// pushed to or pulled from that registry any more.
const REGISTRY = 'registry.openape.ai'

// docker-pussh v0.4.3 hardcodes its unregistry image (0.4.1) and only honours
// UNREGISTRY_IMAGE. That container gets chatty's containerd socket, so pin it
// by digest (multi-arch index of 0.4.1), not just by a mutable tag.
export const PUSSH_ENV = { ...process.env, UNREGISTRY_IMAGE: 'ghcr.io/psviderski/unregistry:0.4.1@sha256:7297f3bb6f503515991e81e249dab81c23d2c350323fc209e3eaa8507a5970b1' }

// `docker pussh --version|--help` exit 0 even without the plugin (docker
// answers them itself), so ask the CLI for its installed plugins.
export function requirePussh() {
  let plugins = ''
  try { plugins = execFileSync('docker', ['info', '--format', '{{range .ClientInfo.Plugins}}{{.Name}} {{end}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
  catch {}
  if (!plugins.split(' ').includes('pussh')) {
    throw new Error('`docker pussh` is not available. Install it with:\n'
      + '  brew install psviderski/tap/docker-pussh\n'
      + '  mkdir -p ~/.docker/cli-plugins && ln -sf "$(brew --prefix)/bin/docker-pussh" ~/.docker/cli-plugins/docker-pussh')
  }
}

// Remove local tags of one image repository except `keep`; never other images.
// Each failure only warns (in-use or already-missing tags stay as they are).
export function cleanupScript(repo, keep) {
  const keepRefs = keep.filter(Boolean).map(tag => `"${repo}:${tag}"`).join('|')
  return `
      docker image ls --format '{{.Repository}}:{{.Tag}}' '${repo}' | while read -r ref; do
        case "$ref" in
          ${keepRefs}|*:'<none>') ;;
          *) docker image rm "$ref" >/dev/null || echo "WARN could not remove $ref" ;;
        esac
      done
    `
}

// Deploy hosts. Every target names one via `host` (default 'chatty').
// `composeFile` is synced to <prodDir>/docker-compose.yml during swap;
// `unitGuard` covers the dormant systemd fallback units that only exist on chatty.
const HOSTS = {
  chatty: {
    ssh: process.env.CHATTY_SSH || 'chatty.delta-mind.at',
    // `docker pussh` target: needs docker (or passwordless sudo docker) access.
    pussh: process.env.CHATTY_PUSSH || 'ubuntu@chatty.delta-mind.at',
    executeAs: 'openape',
    prodDir: '/home/openape/prod',
    composeFile: 'compose/chatty.yml',
    unitGuard: true,
  },
}

const TARGETS = {
  'free-idp': { filter: 'openape-free-idp', dir: 'apps/openape-free-idp', image: 'openape-free-idp', port: 3003, compose: 'idp', unit: 'openape-free-idp', domain: 'id.openape.ai', envVar: 'IDP_TAG' },
  'pods-idp': { filter: 'openape-free-idp', dir: 'apps/openape-free-idp', image: 'openape-pods-idp', port: 3027, compose: 'pods-idp', unit: 'openape-pods-idp', domain: 'pods.openape.ai', envVar: 'PODS_IDP_TAG' },
  'pods-relay': { filter: '@openape-pods-relay/app', dir: 'apps/openape-pods-relay', image: 'openape-pods-relay', port: 3028, compose: 'pods-relay', unit: 'openape-pods-relay', domain: 'pods.openape.ai', envVar: 'PODS_RELAY_TAG', dockerfile: 'compose/pods-relay-package.Dockerfile', healthPath: '/api/mobile/v1/health', healthService: 'openape-pods-relay', smokeRuntime: ['--user', '999:988', '--read-only', '--tmpfs', '/tmp:size=32m,mode=1777', '-e', 'NUXT_RELAY_ENABLED=true', '-e', 'NUXT_RELAY_DATABASE=/tmp/relay.sqlite'] },
  'testrun': { filter: '@openape-testrun/app', dir: 'apps/openape-testrun', image: 'openape-testrun', port: 3006, compose: 'testrun', unit: 'openape-testrun', domain: 'testrun.openape.ai', envVar: 'TESTRUN_TAG' },
  'tasks': { filter: '@openape-tasks/app', dir: 'apps/openape-tasks', image: 'openape-tasks', port: 3005, compose: 'tasks', unit: 'openape-tasks', domain: 'tasks.openape.ai', envVar: 'TASKS_TAG' },
  'pr': { filter: '@openape-pr/app', dir: 'apps/openape-pr', image: 'openape-pr', port: 3014, compose: 'pr', unit: 'openape-pr', domain: 'pr.openape.ai', envVar: 'PR_TAG' },
  'plans': { filter: '@openape-plans/app', dir: 'apps/openape-plans', image: 'openape-plans', port: 3004, compose: 'plans', unit: 'openape-plans', domain: 'plans.openape.ai', envVar: 'PLANS_TAG' },
  'timetrack': { filter: '@openape-timetrack/app', dir: 'apps/openape-timetrack', image: 'openape-timetrack', port: 3011, compose: 'timetrack', unit: 'openape-timetrack', domain: 'timetrack.openape.ai', envVar: 'TIMETRACK_TAG' },
  'monitor': { filter: '@openape-monitor/app', dir: 'apps/openape-monitor', image: 'openape-monitor', port: 3018, compose: 'monitor', unit: 'openape-monitor', domain: 'monitor.openape.ai', envVar: 'MONITOR_TAG' },
  'dashboard': { filter: '@openape-dashboard/app', dir: 'apps/openape-dashboard', image: 'openape-dashboard', port: 3022, compose: 'dashboard', unit: 'openape-dashboard', domain: 'dashboard.openape.ai', envVar: 'DASHBOARD_TAG' },
  'secrets': { filter: '@openape-secrets/app', dir: 'apps/openape-secrets', image: 'openape-secrets', port: 3025, compose: 'secrets', unit: 'openape-secrets', domain: 'secrets.openape.ai', envVar: 'SECRETS_TAG' },
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}
// Quiet variant for the concurrent bake phase — interleaved inherited stdio
// from parallel docker builds is unreadable, so capture instead.
function shQuiet(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}
function out(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
}
function ssh(host, script) {
  return execFileSync('ssh', ['-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', host.ssh, ...(host.executeAs ? ['sudo', '-n', '-u', host.executeAs] : []), 'bash', '-s'], {
    input: script,
    encoding: 'utf8',
  }).trim()
}
function groupByHost(targets) {
  const groups = new Map()
  for (const t of targets) {
    const key = t.host || 'chatty'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  return groups
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
function tagFor(t, sha) {
  return `${REGISTRY}/${t.image}:prod-${sha}`
}

async function smokeTest(tag, target) {
  const port = target.port
  const name = `smoke-${port}`
  try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }) }
  catch {}
  shQuiet('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '--platform',
    'linux/amd64',
    '-p',
    `127.0.0.1:1${port}:${port}`,
    // Dummy env so apps that hard-require config still boot for /api/health.
    '-e',
    'NUXT_OPENAPE_IDP_SESSION_SECRET=smoke-test-session-secret-0000000000',
    '-e',
    'NUXT_OPENAPE_SP_SESSION_SECRET=smoke-test-session-secret-0000000000',
    '-e',
    'NUXT_TURSO_URL=file:/tmp/smoke.db',
    ...(target.smokeRuntime ?? []),
    tag,
  ])
  try {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:1${port}/api/health`)
        if (res.ok && healthyResponse(await res.json(), target.healthService))
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

export function healthyResponse(value, service) {
  return value?.ok === true && (!service || value.service === service)
}

async function externalHealth(domain, path = '/api/health', service) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`https://${domain}${path}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok && healthyResponse(await res.json(), service))
        return true
    }
    catch {}
    await sleep(3000)
  }
  return false
}

// ── phase 3: bake one image (package → smoke → pussh), no prod touch ─────────
async function bake(name, sha) {
  const t = TARGETS[name]
  const tag = tagFor(t, sha)
  shQuiet('docker', ['buildx', 'build', '--platform', 'linux/amd64', '-f', t.dockerfile || 'compose/preview-package.Dockerfile', '--build-arg', `PORT=${t.port}`, '-t', tag, '--load', `${t.dir}/.output`])
  await smokeTest(tag, t)
  shQuiet('docker', ['pussh', tag, HOSTS[t.host || 'chatty'].pussh], { env: PUSSH_ENV })
  console.log(`  ✓ baked ${name} (${tag})`)
}

export function rollbackScript(prodDir, group, prevMap) {
  return `
      set -euo pipefail
      cd ${prodDir}
${group.map((t) => {
  const prev = prevMap[t.name]
  if (!prev) return `      docker compose --env-file .env -f docker-compose.yml stop ${t.compose}\n      echo "${t.name}: first deployment stopped; no previous image exists"`
  return `      grep -vE '^${t.envVar}=' .env > .env.new && mv .env.new .env
      echo "${t.envVar}=${prev}" >> .env`
}).join('\n')}
      ${group.filter(t => prevMap[t.name]).length ? `docker compose --env-file .env -f docker-compose.yml up -d ${group.filter(t => prevMap[t.name]).map(t => t.compose).join(' ')}` : ':'}
    `
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
  const truth = resolveTruthRemote(gitRemotes())
  const base = `${truth}/${repository.defaultBranch}`
  if (args.includes('--dry-run')) {
    console.log(JSON.stringify({ repository: repository.url, remote: truth, baseRef: base, sha, targets: names, dryRun: true }, null, 2))
    return
  }
  requirePussh()

  // Guard: the image is built from the WORKING TREE. Deploying from a checkout
  // that lags origin/main silently rolls prod back to that older state — the
  // health gate can't catch it (the app is healthy, just old). Incident
  // 2026-07-21: a deploy from a 5-day-old feature branch removed the entire
  // proactive-operators stack from prod overnight.
  if (!args.includes('--force')) {
    out('git', ['fetch', '--quiet', truth, repository.defaultBranch])
    try {
      out('git', ['merge-base', '--is-ancestor', base, 'HEAD'])
    }
    catch {
      const behind = out('git', ['rev-list', '--count', `HEAD..${truth}/main`])
      throw new Error(
        `HEAD does not contain ${truth}/main (${behind} commit(s) behind) — deploying would roll prod back.\n`
        + `Deploy from an up-to-date main (e.g. a worktree of ${truth}/main), or override with --force.`,
      )
    }
    const dirty = out('git', ['status', '--porcelain', '--', ...targets.map(t => t.dir), 'packages', 'modules'])
    if (dirty) console.warn(`\n⚠ uncommitted changes will be baked into the image:\n${dirty}\n`)
  }

  // 1. guard — all units inactive (one ssh per host with dormant units)
  for (const [hostKey, group] of groupByHost(targets)) {
    if (!HOSTS[hostKey].unitGuard) continue
    const active = ssh(HOSTS[hostKey], group.map(t => `echo "${t.name}:$(systemctl is-active ${t.unit} 2>/dev/null || echo inactive)"`).join('\n'))
      .split('\n')
      .filter(l => l.endsWith(':active'))
      .map(l => l.split(':')[0])
    if (active.length) {
      throw new Error(
        `systemd unit(s) still active on ${hostKey}: ${active.join(', ')} — one-time cutover needed first:\n${
          active.map(n => `  (as ubuntu) sudo systemctl stop ${TARGETS[n].unit} && sudo systemctl disable ${TARGETS[n].unit}`).join('\n')}`,
      )
    }
  }

  // 2. build — one turbo wave for all targets (parallel)
  console.log(`\n━━━ build (${names.length}) → prod-${sha}`)
  sh('pnpm', ['turbo', 'run', 'build', ...targets.map(t => `--filter=${t.filter}`)])

  // 3. bake — package + smoke + pussh, concurrently, NO prod touch
  console.log(`\n━━━ bake (package → smoke → pussh), concurrent`)
  await Promise.all(targets.map(t => bake(t.name, sha)))

  // 4. swap — per host: sync compose, pin all tags (capture PREV), one compose up
  const prevMap = {}
  for (const [hostKey, group] of groupByHost(targets)) {
    const host = HOSTS[hostKey]
    console.log(`\n━━━ swap on ${hostKey} (one compose up for ${group.map(t => t.name).join(', ')})`)
    if (host.executeAs) {
      const staged = `/tmp/openape-compose-${process.pid}.yml`
      sh('scp', ['-q', host.composeFile, `${host.ssh}:${staged}`])
      ssh(host, `set -eu\ninstall -m 644 ${staged} ${host.prodDir}/docker-compose.yml`)
      sh('ssh', [host.ssh, 'rm', staged])
    }
    else {
      sh('scp', ['-q', host.composeFile, `${host.ssh}:${host.prodDir}/docker-compose.yml`])
    }
    const composes = group.map(t => t.compose).join(' ')
    const pinScript = `
    set -euo pipefail
    cd ${host.prodDir}
    touch .env
    cp .env .env.bak
${group.map(t => `    OLD_${t.envVar}=$(grep -E '^${t.envVar}=' .env | cut -d= -f2- || true)
    grep -vE '^${t.envVar}(_PREV)?=' .env > .env.new && mv .env.new .env
    [ -n "$OLD_${t.envVar}" ] && echo "${t.envVar}_PREV=$OLD_${t.envVar}" >> .env
    echo "${t.envVar}=prod-${sha}" >> .env`).join('\n')}
    docker compose --env-file .env -f docker-compose.yml up -d --pull never ${composes}
${group.map(t => `    echo "PREV ${t.name} $OLD_${t.envVar}"`).join('\n')}
  `
    for (const line of ssh(host, pinScript).split('\n')) {
      const m = line.match(/^PREV (\S+) (.*)$/)
      if (m) prevMap[m[1]] = m[2].trim()
    }
  }

  // 5. gate — external health per target in parallel; rollback failures
  console.log(`\n━━━ health gate (parallel)`)
  const results = await Promise.all(targets.map(async t => ({ name: t.name, ok: await externalHealth(t.domain, t.healthPath, t.healthService) })))
  for (const r of results.filter(r => r.ok))
    console.log(`  ✓ ${r.name} healthy (prod-${sha}${prevMap[r.name] ? `, prev ${prevMap[r.name]}` : ''})`)

  // Clean up healthy targets only: drop local tags other than TAG and TAG_PREV.
  for (const [hostKey, group] of groupByHost(results.filter(r => r.ok).map(r => ({ name: r.name, ...TARGETS[r.name] })))) {
    try {
      const log = ssh(HOSTS[hostKey], group.map(t => cleanupScript(`${REGISTRY}/${t.image}`, [`prod-${sha}`, prevMap[t.name]])).join('\n'))
      if (log) console.warn(log)
    }
    catch (e) { console.warn(`⚠ image cleanup on ${hostKey} failed (deploy is healthy): ${e.message}`) }
  }

  const failed = results.filter(r => !r.ok).map(r => r.name)
  if (failed.length) {
    console.error(`\n✗ health gate failed: ${failed.join(', ')} — rolling back`)
    for (const [hostKey, group] of groupByHost(failed.map(n => ({ name: n, ...TARGETS[n] })))) {
      const host = HOSTS[hostKey]
      const rollScript = rollbackScript(host.prodDir, group, prevMap)
      ssh(host, rollScript)
    }
    console.error(`→ rolled back: ${failed.map(n => `${n}→${prevMap[n] || '(none)'}`).join(', ')}`)
    throw new Error(`deploy failed health gate: ${failed.join(', ')}`)
  }

  console.log(`\n✅ deployed via image path: ${names.join(', ')} (prod-${sha})`)
}

// Only run when invoked directly, so deploy-image.test.mjs can import the
// helpers without triggering a deploy.
if (process.argv[1] === fileURLToPath(import.meta.url))
  await main()
