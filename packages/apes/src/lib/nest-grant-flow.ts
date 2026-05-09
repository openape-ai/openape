// Shared grant-flow helper for `apes nest <subcommand>`. Identical
// shape to runAudienceMode in commands/run.ts but trimmed down: the
// nest audience never goes through escapes, the token always feeds an
// HTTP-API call. Extracted into its own module so list/status/spawn/
// destroy don't each re-invent the polling loop.
//
// Why not call `apes run nest …` and capture stdout? Because `apes run`
// is a citty command, shelling out from one citty command into another
// loses error fidelity (CliExit codes, consola output) and adds a
// node-startup roundtrip per call. Direct function-call is cheaper and
// gives us typed errors.

import { hostname } from 'node:os'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../config'
import { CliError } from '../errors'
import { apiFetch, getGrantsEndpoint } from '../http'

const NEST_AUDIENCE = 'nest'

export interface RequestNestGrantOptions {
  /** Command array — e.g. ['nest','spawn','igor18']. Joined with
   *  spaces becomes the YOLO target string. */
  command: string[]
  /** Target host that is supposed to honour the grant. Defaults to
   *  the local hostname (so the grant is for our own Nest). */
  targetHost?: string
  /** Override approval mode. Default 'once' — YOLO auto-approves. */
  approval?: 'once' | 'timed' | 'always'
  /** Reason string surfaced in the grant approval UI. */
  reason?: string
  /** IdP URL override (for tests / staging). */
  idp?: string
}

/**
 * Request a Nest grant from the IdP, wait for approval, fetch the
 * authz_jwt. Returns the token string — the caller passes it as
 * `Authorization: Bearer …` to the Nest's HTTP API.
 *
 * Reuse path: before creating a fresh grant we look for an existing
 * approved 'always'/'timed' grant whose `command` array equals ours
 * exactly. If found, we just fetch a new token off it. This is the
 * "approve once, run forever" UX human callers expect — Nest commands
 * default to `approval: 'always'` so the first prompt grants a
 * reusable record.
 */
export async function requestNestGrant(opts: RequestNestGrantOptions): Promise<string> {
  const auth = loadAuth()
  if (!auth) {
    throw new CliError('Not logged in. Run `apes login` first.')
  }

  const idp = getIdpUrl(opts.idp) ?? undefined
  if (!idp) {
    throw new CliError('No IdP URL resolved. Pass --idp or run `apes login` first.')
  }
  const grantsUrl = await getGrantsEndpoint(idp)
  const targetHost = opts.targetHost ?? hostname()
  const approval = opts.approval ?? 'always'

  // Reuse: find an existing approved 'timed'/'always' grant for the
  // exact same command array on this target_host. Strict-equality
  // match — `nest list` and `nest spawn igor18` are separate grants
  // intentionally so revoking one doesn't kill the other.
  const reusableId = await findReusableNestGrant({
    grantsUrl, requester: auth.email, command: opts.command, targetHost,
  })
  if (reusableId) {
    const { authz_jwt } = await apiFetch<{ authz_jwt: string }>(`${grantsUrl}/${reusableId}/token`, {
      method: 'POST',
    })
    return authz_jwt
  }

  consola.info(`Requesting nest grant: ${opts.command.join(' ')}`)
  const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
    method: 'POST',
    body: {
      requester: auth.email,
      target_host: targetHost,
      audience: NEST_AUDIENCE,
      grant_type: approval,
      command: opts.command,
      reason: opts.reason ?? opts.command.join(' '),
    },
  })

  // Fast path: YOLO auto-approval is decided server-side at create
  // time, so the very first GET often returns 'approved'. We still
  // fall through to the polling loop in case the YOLO check is
  // briefly disabled and a human approves manually.
  let approved = grant.status === 'approved'
  const maxWait = 15 * 60 * 1000
  const interval = 3_000
  const start = Date.now()
  while (!approved && Date.now() - start < maxWait) {
    const status = await apiFetch<{ status: string }>(`${grantsUrl}/${grant.id}`)
    if (status.status === 'approved') {
      approved = true
      break
    }
    if (status.status === 'denied' || status.status === 'revoked') {
      throw new CliError(`Grant ${status.status}.`)
    }
    if (!approved) {
      consola.info(`Waiting for approval: ${idp}/grant-approval?grant_id=${grant.id}`)
      await new Promise(r => setTimeout(r, interval))
    }
  }
  if (!approved) {
    throw new CliError(
      `Grant approval timed out after 15 min (still pending). Check your DDISA inbox at ${idp}/grant-approval?grant_id=${grant.id}.`,
    )
  }

  const { authz_jwt } = await apiFetch<{ authz_jwt: string }>(`${grantsUrl}/${grant.id}/token`, {
    method: 'POST',
  })
  return authz_jwt
}

/** Default localhost URL for the Nest's HTTP API. */
export function nestBaseUrl(port?: number): string {
  const p = port ?? Number(process.env.OPENAPE_NEST_PORT ?? 9091)
  return `http://127.0.0.1:${p}`
}

interface ReusableNestGrantOptions {
  grantsUrl: string
  requester: string
  command: string[]
  targetHost: string
}

interface NestGrantListEntry {
  id: string
  status: string
  expires_at?: number
  request: {
    audience: string
    target_host: string
    grant_type: string
    command?: string[]
  }
}

/**
 * Look for an existing approved 'timed' or 'always' Nest-grant whose
 * command array equals our request exactly. Returns the grant id, or
 * null if no reusable grant exists. Network/parse errors fall through
 * silently — the caller will create a fresh grant.
 */
async function findReusableNestGrant(opts: ReusableNestGrantOptions): Promise<string | null> {
  try {
    const grants = await apiFetch<{ data: NestGrantListEntry[] }>(
      `${opts.grantsUrl}?requester=${encodeURIComponent(opts.requester)}&status=approved&limit=50`,
    )
    const now = Math.floor(Date.now() / 1000)
    const match = grants.data.find((g) => {
      const r = g.request
      if (r.audience !== NEST_AUDIENCE) return false
      if (r.target_host !== opts.targetHost) return false
      if (r.grant_type === 'once') return false
      if (r.grant_type === 'timed' && g.expires_at && g.expires_at <= now) return false
      const cmd = r.command ?? []
      if (cmd.length !== opts.command.length) return false
      return cmd.every((c, i) => c === opts.command[i])
    })
    return match?.id ?? null
  }
  catch {
    return null
  }
}
