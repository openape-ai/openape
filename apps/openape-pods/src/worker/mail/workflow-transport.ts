import type { MailWorkflowConfiguration, WorkflowMail, MailEffectOutcome, MailMoveReceipt } from '../../contracts/mail-workflow'
import { parseWorkflowMail } from '../../contracts/mail-workflow'
import type { WorkflowMailTransport } from './workflow'
import type { HttpReply, HttpRequest } from '../../contracts/http'

interface Services { tool: (body: unknown) => Promise<unknown>, credential: (alias: string) => Promise<string>, http: (request: HttpRequest) => Promise<HttpReply>, assertCurrent: () => void }
function graphMail(value: unknown): WorkflowMail {
  if (!value || typeof value !== 'object') throw new Error('Invalid workflow mail message')
  const item = value as Record<string, unknown>
  const email = (value: unknown): string => ((value as { emailAddress?: { address?: string } })?.emailAddress?.address ?? '').toLowerCase()
  const list = (key: string): string[] => Array.isArray(item[key]) ? (item[key] as unknown[]).map(email) : []
  const headers = item.internetMessageHeaders as { name: string, value: string }[] | undefined
  const listId = headers?.find(header => header.name.toLowerCase() === 'list-id')?.value.trim() ?? null
  return parseWorkflowMail({ id: item.id, version: item.changeKey, folder: item.parentFolderId, conversation: item.conversationId ?? '', sender: email(item.from), participants: [email(item.sender), ...list('replyTo'), ...list('toRecipients'), ...list('ccRecipients')].filter(Boolean), subject: item.subject ?? '', body: (item.body as { content?: string })?.content ?? '', receivedAt: Date.parse(String(item.receivedDateTime)), listId, hasAttachments: item.hasAttachments === true, flagged: (item.flag as { flagStatus?: string })?.flagStatus === 'flagged', important: item.importance === 'high' })
}
export function createWorkflowMailTransport(configuration: MailWorkflowConfiguration, services: Services): WorkflowMailTransport {
  async function invoke(operation: string, args: string[] = []): Promise<Record<string, unknown>> {
    services.assertCurrent()
    const result = await services.tool({ applicationId: configuration.applicationId, argv: ['workflow', operation, '--account', configuration.mailbox, ...args] }) as { exitCode?: number, stdout?: string }
    services.assertCurrent()
    if (result?.exitCode !== 0 || typeof result.stdout !== 'string') throw new Error('The assigned mail application did not return a workflow receipt')
    const reply = JSON.parse(result.stdout) as Record<string, unknown>
    if (reply.protocol !== 'pods-mail/v1' || reply.account !== configuration.mailbox || reply.operation !== operation || !['confirmed', 'notApplied', 'unknown'].includes(reply.outcome as string)) throw new Error('Mail transport reply changed account or operation')
    return reply
  }
  return {
    assertCurrent: services.assertCurrent,
    conditionalMoveVerified: false,
    async delta(cursor) {
      const reply = await invoke('delta', cursor ? ['--cursor', cursor] : [])
      if (reply.outcome !== 'confirmed' || !Array.isArray(reply.items)) throw new Error('Mail enumeration is incomplete or has an invalid boundary')
      const removed: string[] = []; const items: WorkflowMail[] = []
      for (const value of reply.items as Record<string, unknown>[]) {
        if (value['@removed']) { if (typeof value.id !== 'string') throw new Error('Invalid removed mail identity'); removed.push(value.id) }
        else {
          items.push(graphMail(value))
        }
      }
      if ((reply.next !== undefined && typeof reply.next !== 'string') || (reply.delta !== undefined && typeof reply.delta !== 'string')) throw new Error('Invalid mail delta cursor')
      return { items, removed, next: reply.next as string | undefined ?? null, delta: reply.delta as string | undefined ?? null }
    },
    async read(id) {
      const reply = await invoke('read', ['--message', id])
      if (reply.outcome === 'notApplied' && reply.reason === 'Not Found') return null
      if (reply.outcome !== 'confirmed' || !Array.isArray(reply.items) || reply.items.length !== 1) throw new Error('Mail preflight read did not complete')
      return graphMail(reply.items[0])
    },
    async move(message): Promise<MailEffectOutcome<MailMoveReceipt>> {
      const reply = await invoke('move', ['--message', message.id, '--expected-version', message.version, '--source-folder', message.folder, '--destination', 'archive'])
      if (reply.outcome !== 'confirmed') return { state: reply.outcome as 'unknown' | 'notApplied', reason: String(reply.reason ?? 'Move outcome unavailable') }
      const moved = graphMail(reply.receipt)
      if (reply.beforeId !== message.id || reply.afterId !== moved.id || moved.folder === message.folder || typeof reply.requestId !== 'string' || !reply.requestId) return { state: 'unknown', reason: 'Move receipt could not be bound to the reviewed message' }
      return { state: 'confirmed', receipt: { beforeId: message.id, afterId: moved.id, version: moved.version, folder: moved.folder, requestId: reply.requestId } }
    },
    async send(body, destination) {
      const token = await services.credential(destination.credential)
      services.assertCurrent()
      const reply = await services.http({ url: `https://api.telegram.org/bot${token}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: destination.chatId, text: body }), key: 'workflow-transport' })
      let result: { ok?: boolean, result?: { message_id?: number, chat?: { id?: number } } }
      try { result = JSON.parse(reply.body) as typeof result }
      catch { return { state: 'unknown', reason: 'Telegram response is not a delivery receipt' } }
      if (reply.status >= 200 && reply.status < 300 && result.ok === true && Number.isSafeInteger(result.result?.message_id) && result.result!.message_id! > 0 && String(result.result?.chat?.id) === destination.chatId) return { state: 'confirmed', receipt: { messageId: result.result!.message_id! } }
      if (reply.status >= 400 && reply.status < 500 && result.ok === false) return { state: 'notApplied', reason: 'Telegram rejected delivery' }
      return { state: 'unknown', reason: 'Telegram delivery was not confirmed' }
    },
  }
}
