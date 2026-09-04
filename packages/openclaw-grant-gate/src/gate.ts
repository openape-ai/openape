import { authFileFor  } from './config.js'
import type { GateConfig } from './config.js'
import {
  approveGrant,
  buildGrantRequestFor,
  createGrant,
  denyGrant,
  grantTypeForDecision,
  waitForDecision,
} from './grants.js'
import { resolveIdentity } from './identity.js'
import { decideExec, wrapWithApeShell } from './wrap.js'

export const DEFAULT_IDP_URL = 'https://id.openape.ai'

/**
 * What the hook should do with an exec call.
 *
 * `allow` means the command may run as-is — either it was auto-approved by a
 * standing/YOLO grant, or it is a shape the gate cannot model and ape-shell
 * owns it. `needsApproval` means a grant is pending and a human has to decide.
 */
export type PreflightOutcome =
  | { kind: 'pass' }
  | { kind: 'block', reason: string }
  | { kind: 'allow', command: string }
  | { kind: 'needsApproval', command: string, grantId: string, display: string, approveUrl: string }

/**
 * Pre-flight one exec call: request the grant before exec starts.
 *
 * Doing this in `before_tool_call` rather than inside the exec tool is the
 * whole point. The baseline measurement saw a human approve 68 s after the
 * request while exec had been killed at ~60 s — an approved grant that
 * produced nothing. Here exec has not started, so its timeout does not apply.
 *
 * Execution still goes through ape-shell: it fetches a grant token and
 * verifies it before running, which makes the grant a capability rather than a
 * flag. Once the grant is approved, ape-shell reuses it instead of asking
 * again. Reimplementing that here would trade a security property for a saved
 * process spawn.
 */
export async function preflightExec(params: {
  agentId: string | undefined
  command: unknown
  config: GateConfig
  idpUrl?: string
}): Promise<PreflightOutcome> {
  const { agentId, command, config } = params

  const local = decideExec({ agentId, command, config })
  if (local.kind === 'block') return local
  if (local.kind === 'pass') return { kind: 'pass' }

  const authHome = config.agents[agentId!]!
  const wrapped = wrapWithApeShell(command as string, config.apeShellPath, authFileFor(config, agentId!)!)

  const identity = await resolveIdentity(authHome)
  // The agent's own IdP, never a global default — see Identity.idp.
  const idp = params.idpUrl ?? identity.idp
  const request = await buildGrantRequestFor(command as string, identity.email)
  // Compound lines and binaries without a shapes adapter have no faithful
  // shape. ape-shell already owns those cases; pre-flighting a grant that
  // describes something other than what runs would be worse than not asking.
  if (request === null) return { kind: 'allow', command: wrapped }

  const grant = await createGrant(request.body, { idp, token: identity.bearer })
  // Standing and YOLO grants come back already approved. Prompting for those
  // would undo the reason they exist.
  if (grant.status === 'approved') return { kind: 'allow', command: wrapped }

  const approveUrl = `${idp}/grant-approval?grant_id=${grant.id}`

  if (config.approvalSurface === 'openclaw') {
    return { kind: 'needsApproval', command: wrapped, grantId: grant.id, display: request.display, approveUrl }
  }

  const status = await waitForDecision(grant.id, {
    idp,
    token: identity.bearer,
    timeoutMs: config.waitTimeoutMs,
  })
  // `used` counts as approved: a grant somebody already consumed was approved
  // by definition, and refusing it would turn a race into a false block.
  if (status === 'approved' || status === 'used') return { kind: 'allow', command: wrapped }
  if (status === null) {
    return {
      kind: 'block',
      reason: `openape-grant-gate: grant ${grant.id} was not decided within ${Math.round(config.waitTimeoutMs / 1000)}s — exec blocked. Approve at ${approveUrl}, then ask again; the grant is reused.`,
    }
  }
  return { kind: 'block', reason: `openape-grant-gate: grant ${grant.id} was ${status} — exec blocked.` }
}

/**
 * Relay an OpenClaw approval decision to the IdP, acting as the **owner**.
 *
 * The identity split is the invariant this package exists to keep: the request
 * was made with the agent's identity, the decision is made with the owner's.
 * The IdP enforces it server-side too — a requester may not approve its own
 * grant — so getting this backwards fails loudly rather than quietly widening
 * anyone's authority.
 *
 * An unresolved approval (timeout, cancelled) deliberately leaves the grant
 * pending rather than denying it. OpenClaw blocks the call either way, and a
 * pending grant can still be approved from the IdP's own surfaces — push,
 * mail, Telegram — so the next attempt succeeds instead of starting over.
 */
export async function relayApproval(
  decision: string,
  grantId: string,
  idpUrl?: string,
): Promise<void> {
  const grantType = grantTypeForDecision(decision)
  const owner = await resolveIdentity()
  const idp = idpUrl ?? owner.idp

  if (grantType !== null) {
    await approveGrant(grantId, grantType, { idp, token: owner.bearer })
    return
  }
  if (decision === 'deny') {
    await denyGrant(grantId, { idp, token: owner.bearer })
  }
}
