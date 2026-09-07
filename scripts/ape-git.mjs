#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { repository } from './repository.mjs'

export class ForgeError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status }
}

export function parseRepository(value = new URL(repository.url).pathname.slice(1).replace(/\.git$/, '')) {
  if (!/^[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*$/i.test(value)) throw new ForgeError('INVALID_REPOSITORY', 'Use --repo owner/name')
  return value
}

export function createClient({ endpoint = new URL(repository.url).origin, authorize, fetcher = fetch } = {}) {
  return async (method, path, body) => {
    if (!path.startsWith('/api/')) throw new ForgeError('INVALID_PATH', 'API path required')
    let authorization
    try {
      const getToken = authorize ?? (await import('../packages/cli-auth/dist/index.js')).getAuthorizedBearer
      authorization = await getToken({ endpoint, aud: new URL(endpoint).host })
    }
    catch { throw new ForgeError('AUTH_REQUIRED', 'OpenApe authentication unavailable. Run apes login for your identity, then retry.') }
    let response
    try {
      response = await fetcher(`${endpoint}${path}`, { method, headers: { authorization, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30_000) })
    }
    catch { throw new ForgeError('NETWORK_ERROR', 'The native forge could not be reached. Check the endpoint and connection.') }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = data.statusMessage || data.message || data.title || `HTTP ${response.status}`
      const code = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'ACCESS_DENIED' : response.status === 404 ? 'NOT_FOUND' : response.status === 409 ? (/check/i.test(message) ? 'CHECKS_BLOCKED' : 'STALE_REVIEW') : 'REQUEST_FAILED'
      throw new ForgeError(code, message, response.status)
    }
    return data
  }
}

export function checkState(statuses, contexts, sha, providerErrors = []) {
  const checks = contexts.map((context) => {
    const found = statuses.find(s => s.context === context && s.sha === sha && s.provider === 'forgejo')
    return { context, state: found?.state ?? 'missing', targetUrl: found?.targetUrl ?? null }
  })
  const state = providerErrors.length ? 'unavailable' : !contexts.length ? 'unconfigured' : checks.some(c => c.state === 'failure') ? 'failure' : checks.every(c => c.state === 'success') ? 'success' : 'pending'
  return { sha, state, checks, providerErrors }
}

function options(args) {
  const flags = {}; const positional = []
  const allowed = new Set(['repo', 'title', 'body-file', 'source', 'target', 'expected-source', 'expected-target', 'context', 'branch', 'timeout', 'interval', 'path', 'line', 'state'])
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') continue
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const key = arg.slice(2)
    if (!allowed.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new ForgeError('USAGE', `Unknown or incomplete option: ${arg}`)
    flags[key] = args[++i]
  }
  return { flags, positional }
}
function fullSha(value) {
  if (!/^[a-f0-9]{40}$/.test(value || '')) throw new ForgeError('USAGE', 'A full 40-character commit SHA is required')
  return value
}
function positive(value, fallback) {
  const n = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new ForgeError('USAGE', 'Expected a positive integer')
  return n
}

export async function execute(argv, request = createClient(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const { flags, positional: p } = options(argv[0] === '--' ? argv.slice(1) : argv)
  const repo = parseRepository(flags.repo)
  const base = `/api/repos/${repo}`
  const bodyText = () => {
    if (!flags['body-file']) throw new ForgeError('USAGE', '--body-file is required (exact UTF-8 content)')
    return readFileSync(flags['body-file'], 'utf8')
  }
  const checks = async (sha) => {
    const [data, policies] = await Promise.all([request('GET', `${base}/statuses/${sha}`), request('GET', `${base}/protections`)])
    const policy = policies.policies.find(p => p.enabled && p.branch === (flags.branch || repository.defaultBranch))
    return { ...checkState(data.statuses, policy?.contexts ?? [], sha, data.providerErrors), statuses: data.statuses }
  }
  if (p[0] === 'repo') {
    const [details, protections] = await Promise.all([request('GET', base), request('GET', `${base}/protections`)])
    return { code: 0, data: { repository: repo, details, protections } }
  }
  if (['checks', 'logs', 'wait'].includes(p[0])) {
    const sha = fullSha(p[1])
    const deadline = Date.now() + positive(flags.timeout, 900) * 1000
    let data
    do {
      data = await checks(sha)
      if (p[0] !== 'wait' || ['success', 'failure', 'unconfigured'].includes(data.state)) break
      if (Date.now() >= deadline) break
      await sleep(Math.min(positive(flags.interval, 10) * 1000, 30_000, deadline - Date.now()))
    } while (Date.now() < deadline)
    if (p[0] === 'logs') {
      data = { sha, state: data.state, logs: data.statuses.filter(s => !flags.context || s.context === flags.context).map(s => ({ context: s.context, state: s.state, log: s.log, targetUrl: s.targetUrl })), providerErrors: data.providerErrors }
    }
    return { code: data.state === 'success' ? 0 : data.state === 'failure' ? 1 : 3, data }
  }
  if (p[0] !== 'pr') throw new ForgeError('USAGE', 'Commands: repo, pr list|show|diff|create|comment|merge, checks SHA, logs SHA, wait SHA')
  if (p[1] === 'list') return { code: 0, data: await request('GET', `${base}/pulls?state=${encodeURIComponent(flags.state || 'open')}`) }
  if (p[1] === 'create') {
    if (!flags.title || !flags.source) throw new ForgeError('USAGE', 'pr create requires --title, --source and --body-file')
    return { code: 0, data: await request('POST', `${base}/pulls`, { title: flags.title, source: flags.source, target: flags.target || repository.defaultBranch, body: bodyText() }) }
  }
  const number = positive(p[2])
  const path = `${base}/pulls/${number}`
  if (['show', 'diff'].includes(p[1])) {
    const data = await request('GET', path)
    if (p[1] === 'show') { const { files: _files, ...summary } = data; return { code: 0, data: summary } }
    return { code: 0, data: { sourceSha: data.sourceSha, targetSha: data.targetSha, files: data.files, truncated: data.truncated } }
  }
  if (p[1] === 'comment') return { code: 0, data: await request('POST', `${path}/comments`, { body: bodyText(), ...(flags.path ? { path: flags.path, line: positive(flags.line) } : {}) }) }
  if (p[1] === 'merge') {
    // Never fetch fresh heads and silently approve them on the caller's behalf.
    const expectedSourceSha = fullSha(flags['expected-source'])
    const expectedTargetSha = fullSha(flags['expected-target'])
    return { code: 0, data: await request('POST', `${path}/merge`, { expectedSourceSha, expectedTargetSha }) }
  }
  throw new ForgeError('USAGE', 'Unknown PR command')
}

async function main() {
  try {
    const result = await execute(process.argv.slice(2))
    console.log(JSON.stringify(result.data, null, 2)); process.exitCode = result.code
  }
  catch (error) {
    console.error(JSON.stringify({ error: { code: error.code || 'LOCAL_ERROR', message: error.message, status: error.status || undefined } }))
    process.exitCode = 2
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
