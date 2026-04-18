import type { OpenApeCliAuthorizationDetail, OpenApeCliResourceRef, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { canonicalizeCliPermission, cliAuthorizationDetailCovers } from './cli-permissions.js'
import type { GrantStore } from './stores.js'

/**
 * Body format for `POST /api/standing-grants`. Stored in the `grants`
 * table as `request` with `type: 'standing'` and `status: 'approved'`
 * (auto-approved — creator IS the approver).
 *
 * Unlike a normal grant-request, this encodes a *pattern* that future
 * incoming grants from the specified delegate will be matched against
 * during `POST /api/grants`. When a match is found, the incoming grant
 * is created with `status: 'approved'` and `decided_by_standing_grant`
 * set to the standing-grant's id for audit-trail.
 */
export interface StandingGrantRequest {
  /** Discriminator — must be 'standing'. */
  type: 'standing'
  /** Who is creating this pre-auth (always the logged-in user). */
  owner: string
  /** Agent email that may have grants auto-approved. */
  delegate: string
  /** Audience restriction (must match incoming grant.audience). */
  audience: string
  /** Optional host restriction — undefined matches any host. */
  target_host?: string
  /** Optional CLI restriction — undefined matches any CLI. */
  cli_id?: string
  /** Resource-chain template with wildcards (selector: undefined = any). */
  resource_chain_template: OpenApeCliResourceRef[]
  /** Action restriction — undefined matches any action. */
  action?: string
  /** Risk cap — auto-approval only fires when incoming.risk <= this. */
  max_risk?: 'low' | 'medium' | 'high' | 'critical'
  /** Standing grants are 'timed' or 'always'; 'once' makes no sense for pre-auth. */
  grant_type: 'timed' | 'always'
  /** Required for 'timed' — seconds until this standing grant expires. */
  duration?: number
  /** Human-readable note surfaced in UI. */
  reason?: string
}

/** What `evaluateStandingGrants` returns on a match. */
export interface StandingGrantMatch {
  standing_grant_id: string
  /** The original incoming authorization_details — unchanged. The match
   *  itself is the proof that the standing grant covers them. */
  derived_authorization_details: OpenApeCliAuthorizationDetail[]
}

/** Risk ordering for `max_risk` cap check. */
const RISK_ORDER: Record<'low' | 'medium' | 'high' | 'critical', number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

/**
 * Type guard for standing-grant shaped requests.
 */
export function isStandingGrantRequest(req: unknown): req is StandingGrantRequest {
  return (
    req !== null
    && typeof req === 'object'
    && (req as { type?: unknown }).type === 'standing'
    && typeof (req as StandingGrantRequest).delegate === 'string'
    && typeof (req as StandingGrantRequest).audience === 'string'
    && Array.isArray((req as StandingGrantRequest).resource_chain_template)
  )
}

/**
 * Construct a `OpenApeCliAuthorizationDetail` that represents the standing
 * grant's pattern, suitable for passing to `cliAuthorizationDetailCovers()`
 * as the "granted" side.
 *
 * The template's `resource_chain_template` becomes the detail's
 * `resource_chain` verbatim — wildcards are expressed as
 * `{ resource: 'x', selector: undefined }` which the existing coverage
 * logic already handles.
 */
export function buildCoverageDetailFromStandingGrant(
  req: StandingGrantRequest,
  incoming: OpenApeCliAuthorizationDetail,
): OpenApeCliAuthorizationDetail {
  const detail: OpenApeCliAuthorizationDetail = {
    type: 'openape_cli',
    cli_id: req.cli_id ?? incoming.cli_id,
    operation_id: incoming.operation_id, // coverage ignores operation_id
    resource_chain: req.resource_chain_template,
    action: req.action ?? incoming.action,
    permission: '',
    display: req.reason ?? `standing:${req.delegate}`,
    risk: req.max_risk ?? 'critical',
  }
  detail.permission = canonicalizeCliPermission(detail)
  return detail
}

/**
 * Evaluate whether any approved standing grant for the incoming request's
 * (owner, delegate, audience) triple covers all of the incoming
 * authorization details.
 *
 * Called from the grant-create endpoint AFTER the existing reuse-check
 * (exact-match against approved grants) and BEFORE the similarity check
 * that produces `pending` grants. Returns `null` when no standing grant
 * matches, in which case the normal pending-approval flow continues.
 *
 * Matching logic for each standing grant:
 *   1. `type === 'standing'` and `status === 'approved'`
 *   2. `delegate === incoming.requester`
 *   3. `audience === incoming.audience`
 *   4. `target_host` undefined OR matches incoming.target_host
 *   5. `cli_id` undefined OR matches each incoming detail's cli_id
 *   6. `action` undefined OR matches each incoming detail's action
 *   7. `max_risk` undefined OR incoming details' risk <= max_risk
 *   8. `cliAuthorizationDetailCovers(template, incoming)` returns true
 *      for EVERY incoming detail
 *   9. Not expired (checked via grant.request.duration + grant.decided_at)
 *
 * Returns the first matching standing grant (stable order: oldest first).
 */
export async function evaluateStandingGrants(
  incoming: OpenApeGrantRequest,
  grantStore: GrantStore,
): Promise<StandingGrantMatch | null> {
  const incomingCli = (incoming.authorization_details ?? [])
    .filter((d): d is OpenApeCliAuthorizationDetail => d.type === 'openape_cli')
  if (incomingCli.length === 0) return null

  // Standing grants are stored with `requester = delegate`, so
  // findByRequester(agent) returns the full candidate set directly —
  // no monorepo-wide scan. See standing-grants/index.post.ts for the
  // normalization rationale.
  const candidates = await grantStore.findByRequester(incoming.requester)

  const now = Math.floor(Date.now() / 1000)
  for (const grant of candidates) {
    if (grant.status !== 'approved') continue
    const req = grant.request as unknown
    if (!isStandingGrantRequest(req)) continue
    if (req.delegate !== incoming.requester) continue
    if (req.audience !== incoming.audience) continue
    // target_host: undefined or '*' means "any host"; specific value must match.
    // '*' is the stored sentinel because the grants table has target_host
    // as NOT NULL — see standing-grants/index.post.ts normalization.
    if (req.target_host && req.target_host !== '*' && req.target_host !== incoming.target_host) continue
    if (grant.expires_at && grant.expires_at < now) continue

    const maxRisk = req.max_risk ? RISK_ORDER[req.max_risk] : Number.POSITIVE_INFINITY
    let allCovered = true
    for (const incomingDetail of incomingCli) {
      if (req.cli_id && req.cli_id !== incomingDetail.cli_id) { allCovered = false; break }
      if (req.action && req.action !== incomingDetail.action) { allCovered = false; break }
      if (RISK_ORDER[incomingDetail.risk] > maxRisk) { allCovered = false; break }
      const template = buildCoverageDetailFromStandingGrant(req, incomingDetail)
      if (!cliAuthorizationDetailCovers(template, incomingDetail)) { allCovered = false; break }
    }
    if (!allCovered) continue

    return {
      standing_grant_id: grant.id,
      derived_authorization_details: incomingCli,
    }
  }
  return null
}
