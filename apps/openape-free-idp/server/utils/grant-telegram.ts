import type { OpenApeGrant } from '@openape/core'
import type { GrantMailDebouncer } from './grant-mail'
import { summarizeRequest } from './summarize-grant'

/**
 * Shorter than the mail cooldown: Telegram is the channel the owner is in
 * anyway, so a minute of silence is enough to swallow a burst without making
 * a real request wait.
 */
export const GRANT_TELEGRAM_COOLDOWN_MS = 60 * 1000

/**
 * `op-delta-mind-cb6bf26a+patrick+hofmann_eco@id.openape.ai` is unreadable on
 * a phone. The part before the first `+` identifies the agent; the rest is
 * the owner suffix the IdP appends, and the full address is one tap away on
 * the approval page anyway.
 */
export function shortRequester(requester: string): string {
  return requester.split('+')[0]!.split('@')[0]!
}

export interface GrantTelegramDeps {
  issuer: string
  chatId: string
  /**
   * A chat belongs to exactly one human. The free IdP serves many, so grants
   * are only announced when the resolved approver IS this person — otherwise
   * a stranger's pending command would land in someone else's chat.
   */
  approver: string
  debouncer: GrantMailDebouncer
  resolveApprover: (requester: string) => Promise<string | null>
  countPendingForApprover: (approver: string) => Promise<number>
  send: (chatId: string, text: string) => Promise<void>
}

export function formatPendingGrantMessage(
  grant: OpenApeGrant,
  issuer: string,
  pendingCount: number,
): string {
  const lines = [
    'Approval needed',
    '',
    shortRequester(grant.request.requester),
    summarizeRequest(grant.request),
    '',
    `${issuer}/grant-approval?grant_id=${encodeURIComponent(grant.id)}`,
  ]
  // Only worth saying when this is not the only one waiting — otherwise it is
  // noise on every single message.
  if (pendingCount > 1) {
    lines.push('', `${pendingCount} waiting · ${issuer}/grants`)
  }
  return lines.join('\n')
}

/**
 * Telegram leg of the grant-pending fan-out (#1292), alongside push (08) and
 * mail (09). Deliberately link-only: an inline approve button would make the
 * Telegram account the authorization instead of the passkey session, and
 * these grants gate root shell commands.
 *
 * Within the cooldown further grants are dropped rather than queued. The next
 * message that does go out names the pending count and links the overview, so
 * a swallowed burst stays discoverable — the same trade the mail leg makes,
 * with a much shorter window.
 */
export async function notifyApproverOfPendingGrantByTelegram(
  grant: OpenApeGrant,
  deps: GrantTelegramDeps,
): Promise<'sent' | 'debounced' | 'skipped'> {
  if (grant.status !== 'pending' || grant.auto_approval_kind) return 'skipped'

  const approver = await deps.resolveApprover(grant.request.requester)
  if (!approver || approver !== deps.approver) return 'skipped'

  if (!deps.debouncer.shouldSend(approver)) return 'debounced'

  try {
    const pendingCount = await deps.countPendingForApprover(approver)
    await deps.send(deps.chatId, formatPendingGrantMessage(grant, deps.issuer, pendingCount))
    return 'sent'
  }
  catch (err) {
    // Reopen the window so the next request gets another chance instead of
    // being silently swallowed by a cooldown a failed send started.
    deps.debouncer.reset(approver)
    throw err
  }
}
