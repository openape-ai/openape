import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { defineCommand } from 'citty'
import { AUTH_FILE, CONFIG_DIR, loadAuth } from '../config'
import { apiFetch, getGrantsEndpoint } from '../http'
import { CliError } from '../errors'

declare const __VERSION__: string

interface HealthArgs {
  json: boolean
}

interface HealthReport {
  version: string
  config: { dir: string }
  auth: {
    file: string
    present: boolean
    email?: string
    type?: 'human' | 'agent'
    idp?: string
    expires_at_iso?: string
    expires_at_local?: string
    expired?: boolean
  }
  idp: { url?: string, reachable: boolean, error?: string }
  grants: { count?: number, error?: string }
  ape_shell_binary: string | null
  ok: boolean
}

const execAsync = promisify(exec)

async function resolveApeShellPath(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('command -v ape-shell', { shell: '/bin/bash' })
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  catch {
    return null
  }
}

async function probeIdp(url: string): Promise<{ reachable: true } | { reachable: false, error: string }> {
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 3000)
  try {
    // Plain fetch — we don't want apiFetch's bearer token or retry logic.
    // HEAD may not be supported; fall back to GET if needed.
    await fetch(url, { method: 'GET', signal: ctrl.signal })
    return { reachable: true }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { reachable: false, error: message }
  }
  finally {
    clearTimeout(timeout)
  }
}

async function bestEffortGrantCount(idp: string): Promise<{ count: number } | { error: string }> {
  try {
    const grantsUrl = await getGrantsEndpoint(idp)
    const res = await apiFetch<{ data: unknown[] }>(`${grantsUrl}?limit=1`)
    const count = Array.isArray(res?.data) ? res.data.length : 0
    return { count }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { error: message }
  }
}

export async function runHealth(args: HealthArgs): Promise<void> {
  const version = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0'

  const auth = loadAuth()
  if (!auth) {
    throw new CliError('Not logged in. Run `apes login` first.', 1)
  }

  const isAgent = auth.email.includes('agent+')
  const expiresDate = new Date(auth.expires_at * 1000)
  const isExpired = Date.now() / 1000 > auth.expires_at

  if (isExpired) {
    throw new CliError(`Token expired at ${expiresDate.toISOString()}. Run \`apes login\`.`, 1)
  }

  const idpProbe = await probeIdp(auth.idp)
  const grantInfo = await bestEffortGrantCount(auth.idp)
  const apeShellPath = await resolveApeShellPath()

  const report: HealthReport = {
    version,
    config: { dir: CONFIG_DIR },
    auth: {
      file: AUTH_FILE,
      present: true,
      email: auth.email,
      type: isAgent ? 'agent' : 'human',
      idp: auth.idp,
      expires_at_iso: expiresDate.toISOString(),
      expires_at_local: expiresDate.toLocaleString(),
      expired: false,
    },
    idp: {
      url: auth.idp,
      reachable: idpProbe.reachable,
      ...('error' in idpProbe ? { error: idpProbe.error } : {}),
    },
    grants: 'count' in grantInfo
      ? { count: grantInfo.count }
      : { error: grantInfo.error },
    ape_shell_binary: apeShellPath,
    ok: idpProbe.reachable,
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  }
  else {
    console.log(`apes ${version}`)
    console.log('')
    console.log(`Config: ${CONFIG_DIR}`)
    console.log(`Auth:   ${AUTH_FILE}`)
    console.log(`        ${auth.email} (${isAgent ? 'agent' : 'human'})`)
    console.log(`        IdP: ${auth.idp}`)
    console.log(`        Token: valid until ${expiresDate.toISOString()} (local: ${expiresDate.toLocaleString()})`)
    console.log('')
    if (idpProbe.reachable) {
      console.log('IdP: reachable')
    }
    else {
      console.log(`IdP: <unreachable: ${idpProbe.error}>`)
    }
    if ('count' in grantInfo) {
      console.log(`Grants: ${grantInfo.count}`)
    }
    else {
      console.log(`Grants: <unreachable: ${grantInfo.error}>`)
    }
    console.log(`ape-shell: ${apeShellPath ?? '(not on PATH)'}`)
  }

  if (!idpProbe.reachable) {
    throw new CliError(`IdP ${auth.idp} unreachable: ${idpProbe.error}`, 1)
  }
}

export const healthCommand = defineCommand({
  meta: {
    name: 'health',
    description: 'Report CLI diagnostic state (auth, IdP, grants, binaries)',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Emit a machine-readable JSON report',
      default: false,
    },
  },
  async run({ args }) {
    await runHealth({ json: Boolean(args.json) })
  },
})
