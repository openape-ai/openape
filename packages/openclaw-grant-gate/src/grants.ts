import { hostname } from 'node:os'
import {
  apiFetch,
  buildStructuredCliGrantRequest,
  getGrantsEndpoint,
  loadOrInstallAdapter,
  parseShellCommand,
  resolveCommand,
} from '@openape/shapes'

/** Terminal states a grant can reach. Anything else means "still waiting". */
export type GrantDecision = 'approved' | 'denied' | 'revoked' | 'used'

export interface CreatedGrant {
  id: string
  status: string
  display: string
}

const DECIDED: ReadonlySet<string> = new Set(['approved', 'denied', 'revoked', 'used'])

/**
 * Build the same structured grant request `ape-shell` would build for this
 * command, so pre-flighting it here does not produce a weaker grant than the
 * path it front-runs.
 *
 * Returns null when the command cannot be modelled — compound lines, or a
 * binary with no shapes adapter. The caller then leaves the command to
 * ape-shell, which has its own fallbacks; guessing a shape here would be a
 * grant that describes something other than what runs.
 */
export async function buildGrantRequestFor(command: string, requester: string): Promise<{ body: unknown, display: string } | null> {
  const parsed = parseShellCommand(command)
  if (!parsed || parsed.isCompound) return null

  const loaded = await loadOrInstallAdapter(parsed.executable)
  if (!loaded) return null

  try {
    const resolved = await resolveCommand(loaded, [parsed.executable.split('/').pop()!, ...parsed.argv])
    const built = await buildStructuredCliGrantRequest(resolved, {
      requester,
      target_host: hostname(),
      grant_type: 'once',
      reason: `openape-grant-gate: ${resolved.detail.display}`,
    })
    return { body: built.request, display: resolved.detail.display }
  }
  catch {
    return null
  }
}

export async function createGrant(body: unknown, opts: { idp: string, token: string }): Promise<CreatedGrant> {
  const grantsUrl = await getGrantsEndpoint(opts.idp)
  const created = await apiFetch<{ id: string, status: string }>(grantsUrl, {
    method: 'POST',
    body,
    token: opts.token,
  })
  return { id: created.id, status: created.status, display: '' }
}

export async function readGrantStatus(id: string, opts: { idp: string, token: string }): Promise<string> {
  const grantsUrl = await getGrantsEndpoint(opts.idp)
  const grant = await apiFetch<{ status: string }>(`${grantsUrl}/${id}`, { token: opts.token })
  return grant.status
}

export function isDecided(status: string): boolean {
  return DECIDED.has(status)
}

/**
 * Poll until the grant is decided or the budget runs out.
 *
 * Returning `null` on timeout is deliberate: the caller turns that into a
 * block. A waiting gate that gives up must never resolve to "allow".
 */
export async function waitForDecision(
  id: string,
  opts: { idp: string, token: string, timeoutMs: number, pollMs?: number, signal?: AbortSignal },
): Promise<GrantDecision | null> {
  const pollMs = opts.pollMs ?? 3000
  const deadline = Date.now() + opts.timeoutMs

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return null
    const status = await readGrantStatus(id, opts)
    if (isDecided(status)) return status as GrantDecision
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  return null
}

/** Grant lifetimes the IdP accepts as an approval override. */
export type GrantType = 'once' | 'timed' | 'always'

/**
 * Approve a grant. The token must belong to the requester's **owner or
 * approver** — the IdP rejects self-approval unless the requester has neither,
 * which is what keeps an agent from signing off its own commands.
 */
export async function approveGrant(
  id: string,
  grantType: GrantType,
  opts: { idp: string, token: string },
): Promise<void> {
  const grantsUrl = await getGrantsEndpoint(opts.idp)
  await apiFetch(`${grantsUrl}/${id}/approve`, {
    method: 'POST',
    body: { grant_type: grantType },
    token: opts.token,
  })
}

export async function denyGrant(id: string, opts: { idp: string, token: string }): Promise<void> {
  const grantsUrl = await getGrantsEndpoint(opts.idp)
  await apiFetch(`${grantsUrl}/${id}/deny`, { method: 'POST', token: opts.token })
}

/** Map an OpenClaw approval decision onto the grant lifetime it implies. */
export function grantTypeForDecision(decision: string): GrantType | null {
  if (decision === 'allow-once') return 'once'
  if (decision === 'allow-always') return 'always'
  return null
}
