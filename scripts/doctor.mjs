#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { root, workspaces } from './check.mjs'
import { gitRemotes, repository, resolveTruthRemote } from './repository.mjs'

export function portCollisions(packages) {
  const ports = new Map()
  for (const p of packages) {
    const port = p.scripts.dev?.match(/--port(?:=|\s+)(\d+)/)?.[1]
    if (port) ports.set(port, [...(ports.get(port) || []), p.name])
  }
  return [...ports].filter(([, names]) => names.length > 1).map(([port, names]) => ({ port: Number(port), workspaces: names }))
}

export function requiredStackServices(services, appName) {
  const regular = Object.entries(services).filter(([, config]) => !config.profiles?.length)
  if (!appName) return { required: regular.map(([name]) => name), appService: null }
  const match = regular.find(([, config]) => config.build?.args?.APP_FILTER === appName)
  return { required: [...new Set(['dns', 'proxy', ...(appName === 'docs' ? [] : ['idp']), ...(match ? [match[0]] : [])])], appService: match?.[0] ?? null }
}

export function listening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (value) => { socket.destroy(); resolve(value) }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1000, () => finish(false))
  })
}

export async function diagnose(args = []) {
  const checks = []
  const add = (name, state, detail, remedy) => checks.push({ name, state, detail, ...(remedy ? { remedy } : {}) })
  const run = (cmd, argv) => execFileSync(cmd, argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).trim()
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const nodeVersion = readFileSync(join(root, '.nvmrc'), 'utf8').trim()
  add('node', process.versions.node === nodeVersion ? 'pass' : 'fail', { actual: process.versions.node, expected: nodeVersion, executable: process.execPath }, 'From the checkout: . ./scripts/activate-node.sh; then pnpm run doctor')
  try {
    const version = run('pnpm', ['--version'])
    add('pnpm', pkg.packageManager === `pnpm@${version}` ? 'pass' : 'fail', version, `Use ${pkg.packageManager}`)
  }
  catch { add('pnpm', 'fail', 'pnpm unavailable', `Install ${pkg.packageManager}`) }
  let remote
  try {
    remote = resolveTruthRemote(gitRemotes(root))
    add('repository', 'pass', { remote, url: repository.url, branch: run('git', ['branch', '--show-current']), sha: run('git', ['rev-parse', 'HEAD']) })
  }
  catch { add('repository', 'fail', 'Canonical remote missing or ambiguous', `Inspect git remote -v; canonical URL: ${repository.url}`) }
  let upstream = null
  try { upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']) }
  catch { /* A new feature branch may not have an upstream yet. */ }
  add('upstream', remote && upstream?.startsWith(`${remote}/`) ? 'pass' : 'warn', upstream, !upstream || !upstream.startsWith(`${remote}/`) ? 'Inspect git branch -vv; use a canonical upstream for this branch, never a mirror' : undefined)
  const dirty = run('git', ['status', '--porcelain']).split('\n').filter(Boolean)
  add('working-tree', dirty.length ? 'warn' : 'pass', { changedPaths: dirty.length }, dirty.length ? 'Inspect git status --short; preserve existing work' : undefined)
  const installed = existsSync(join(root, 'node_modules/.modules.yaml'))
  add('dependencies', installed ? 'pass' : 'fail', installed ? 'pnpm installation metadata present (integrity not inferred)' : 'Dependencies are not installed', 'pnpm install --frozen-lockfile')
  const built = existsSync(join(root, 'packages/cli-auth/dist/index.js'))
  add('cli-auth-build', built ? 'pass' : 'fail', built ? 'CLI auth build present (freshness not inferred)' : 'CLI auth build absent', 'pnpm check:affected --dry-run; then run the listed prebuild')
  let packages = []
  try {
    packages = workspaces()
    run('node', ['scripts/workspace-map.mjs', '--check'])
    add('workspace-docs', 'pass', `${packages.length} workspaces; generated documentation matches`)
  }
  catch { add('workspace-docs', 'fail', 'Workspace inventory or generated documentation unavailable/stale', 'pnpm graph; review generated changes') }
  const collisions = portCollisions(packages)
  add('dev-ports', collisions.length ? 'warn' : 'pass', collisions, collisions.length ? 'Choose distinct ports before starting these apps together' : undefined)
  const appIndex = args.indexOf('--app')
  if (appIndex !== -1) {
    const app = packages.find(p => [p.name, p.path, p.path.split('/').at(-1)].includes(args[appIndex + 1]))
    if (!app) add('app', 'fail', 'Unknown or missing workspace name', 'Read docs/architecture/workspace-map.md')
    else add('app', 'info', { name: app.name, command: app.scripts.dev ? `pnpm --filter ${app.name} dev` : null, script: app.scripts.dev ?? null, config: existsSync(join(root, app.path, 'nuxt.config.ts')) ? `${app.path}/nuxt.config.ts` : `${app.path}/package.json`, sessionSecretPresent: Boolean(process.env.NUXT_OPENAPE_SP_SESSION_SECRET), isolatedDatabaseConfigured: Boolean(process.env.NUXT_TURSO_URL) }, 'Read docs/operations/local-development.md for isolated config and login fixtures')
  }
  if (args.includes('--services')) {
    const app = packages.find(p => [p.name, p.path, p.path.split('/').at(-1)].includes(args[appIndex + 1]))
    const port = Number(app?.scripts.dev?.match(/--port(?:=|\s+)(\d+)/)?.[1])
    if (port) add('app-port', 'info', { port, listening: await listening(port), note: 'TCP listener presence only; application identity and health are not inferred' }, 'Use an unused explicit port for an isolated startup')
    try {
      const rows = run('docker', ['compose', '-f', 'compose/local-stack.yml', 'ps', '--format', 'json']).split('\n').filter(Boolean).map(line => JSON.parse(line))
      const config = JSON.parse(run('docker', ['compose', '-f', 'compose/local-stack.yml', 'config', '--format', 'json', '--no-interpolate']))
      const { required, appService } = requiredStackServices(config.services, app?.name)
      if (app && !appService) add('app-stack-service', 'warn', `${app.name} is not provided by the local stack`, 'Use the app command and isolated IdP fixtures from docs/operations/local-development.md')
      const missing = required.filter(name => !rows.some(r => r.Service === name && r.State === 'running' && (!r.Health || r.Health === 'healthy')))
      add('local-stack', missing.length ? 'fail' : 'pass', { missing, services: rows.map(r => ({ name: r.Service, state: r.State, health: r.Health })) }, missing.length ? 'Read docs/local-stack/README.md; start with docker compose -f compose/local-stack.yml up -d --build (no reset)' : undefined)
    }
    catch { add('local-stack', 'fail', 'Docker daemon or local stack is unavailable', 'Start Docker if using the container stack; see docs/local-stack/README.md. Isolated test fixtures do not require this stack.') }
  }
  if (args.includes('--network')) {
    if (remote) {
      try {
        const line = run('git', ['ls-remote', repository.url, `refs/heads/${repository.defaultBranch}`])
        const sha = line.split(/\s/)[0]
        if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('No main')
        let cached = null
        try { cached = run('git', ['rev-parse', `refs/remotes/${remote}/${repository.defaultBranch}`]) }
        catch { /* Fresh metadata has no tracking ref. */ }
        add('canonical-main', cached === sha ? 'pass' : 'warn', { liveSha: sha, cachedSha: cached }, cached !== sha ? `git fetch ${remote}` : undefined)
      }
      catch { add('canonical-main', 'fail', 'Cannot read canonical main', 'Check network and Git credentials') }
    }
    try {
      const { createClient } = await import('./ape-git.mjs')
      const request = createClient()
      const base = `/api/repos${new URL(repository.url).pathname.replace(/\.git$/, '')}`
      const [mirrors, policies] = await Promise.all([request('GET', `${base}/mirrors`), request('GET', `${base}/protections`)])
      add('forge-access', 'pass', { mirrors, policies })
    }
    catch (error) { add('forge-access', 'fail', { code: error.code || 'UNAVAILABLE' }, 'Authenticate with apes login and retry; no credentials are printed') }
  }
  return { readOnly: true, root, checks, ok: checks.every(c => c.state !== 'fail') }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await diagnose(process.argv.slice(2))
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1
}
