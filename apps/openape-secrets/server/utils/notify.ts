import type { SecretRequestRow } from './request-view'

export interface NotifyDeps {
  /** Absolute base of this service, e.g. https://secrets.openape.ai */
  publicUrl: string
  /** Only this person's requests may be announced to the configured chat. */
  approver: string
  chatId: string
  send: (chatId: string, text: string) => Promise<void>
}

/**
 * What the owner reads on their phone. Deliberately short and specific: who is
 * asking, for what, and one link. A notification that needs a second reading
 * gets ignored, and a gate nobody opens is a gate nobody uses.
 */
export function formatRequestMessage(row: SecretRequestRow, consumerName: string, publicUrl: string): string {
  return [
    'A machine needs a secret',
    '',
    `${row.fieldName} for ${consumerName}`,
    row.purpose || `asked by ${row.requester}`,
    '',
    `${publicUrl.replace(/\/$/, '')}/fill/${row.id}`,
  ].join('\n')
}

/**
 * Telegram leg of the request fan-out. Scoped to one named person, because the
 * free IdP behind this serves many and a chat belongs to exactly one — an
 * unscoped notifier would drop a stranger's request into someone else's chat,
 * complete with a link that looks entirely official.
 *
 * Never throws into the request path: a request that exists but was not
 * announced is recoverable (the owner sees it in the list), a create that
 * fails because Telegram was down is not.
 */
export async function notifyOwnerOfRequest(
  row: SecretRequestRow,
  consumerName: string,
  deps: NotifyDeps,
): Promise<'sent' | 'skipped'> {
  if (row.ownerEmail !== deps.approver) return 'skipped'
  await deps.send(deps.chatId, formatRequestMessage(row, consumerName, deps.publicUrl))
  return 'sent'
}
