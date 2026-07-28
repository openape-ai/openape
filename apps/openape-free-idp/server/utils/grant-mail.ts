import type { OpenApeGrant } from '@openape/core'
import { summarizeRequest } from './summarize-grant'

/**
 * Per-approver mail cooldown (#1059): an agent bursting out many grant
 * requests must produce ONE mail, not twenty. Within the window the
 * mail already sent covers the burst — it links the grants overview
 * and names the total pending count.
 */
export const GRANT_MAIL_COOLDOWN_MS = 5 * 60 * 1000

export interface GrantMailDebouncer {
  /** Returns true and stamps the window when a mail may go out now. */
  shouldSend: (approver: string, now?: number) => boolean
  /** Reopens the window, e.g. after a failed send. */
  reset: (approver: string) => void
}

/**
 * State lives in process memory: the IdP runs as a single container,
 * and a restart at worst costs one extra mail — no queue system needed.
 */
export function createGrantMailDebouncer(cooldownMs: number = GRANT_MAIL_COOLDOWN_MS): GrantMailDebouncer {
  const lastSentAt = new Map<string, number>()
  return {
    shouldSend(approver, now = Date.now()) {
      const last = lastSentAt.get(approver)
      if (last !== undefined && now - last < cooldownMs) return false
      lastSentAt.set(approver, now)
      return true
    },
    reset(approver) {
      lastSentAt.delete(approver)
    },
  }
}

export interface PendingGrantMail {
  requester: string
  summary: string
  approveUrl: string
  overviewUrl: string
  pendingCount: number
}

export interface GrantMailDeps {
  issuer: string
  debouncer: GrantMailDebouncer
  /** Approver for a requester (users.approver ?? own email), null if no user row. */
  resolveApprover: (requester: string) => Promise<string | null>
  countPendingForApprover: (approver: string) => Promise<number>
  sendMail: (to: string, mail: PendingGrantMail) => Promise<void>
}

/**
 * Mail leg of the grant-pending fan-out (#1059). Headless agents
 * (worker, hook, launchd) never see the approve URL ape-shell prints
 * to stdout — without a mail the owner misses pending grants entirely.
 *
 * Fires only for grants that REALLY await a human: pre-approval hooks
 * (YOLO, standing grants) have already run when the pending hook fires,
 * so anything auto-approved is skipped here.
 */
export async function notifyApproverOfPendingGrantByMail(
  grant: OpenApeGrant,
  deps: GrantMailDeps,
): Promise<'sent' | 'debounced' | 'skipped'> {
  if (grant.status !== 'pending' || grant.auto_approval_kind) return 'skipped'

  const approver = await deps.resolveApprover(grant.request.requester)
  if (!approver) return 'skipped'

  if (!deps.debouncer.shouldSend(approver)) return 'debounced'

  const pendingCount = await deps.countPendingForApprover(approver)
  try {
    await deps.sendMail(approver, {
      requester: grant.request.requester,
      summary: summarizeRequest(grant.request),
      // Same URL ape-shell prints to stdout for interactive callers.
      approveUrl: `${deps.issuer}/grant-approval?grant_id=${encodeURIComponent(grant.id)}`,
      overviewUrl: `${deps.issuer}/grants`,
      pendingCount,
    })
  }
  catch (err) {
    // A failed send must not consume the cooldown — the next pending
    // grant retries instead of going silent for the whole window.
    deps.debouncer.reset(approver)
    throw err
  }
  return 'sent'
}
