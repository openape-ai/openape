import { createHash } from 'node:crypto'

const fingerprint = value => createHash('sha256').update(value).digest('hex')
const maximumMessages = 1000

export async function run(context) {
  const { mail_account: account, o365_application_id: applicationId, telegram_chat_id: chatId, language = 'de' } = context.variables
  if (!account || !applicationId || !chatId) throw new Error('Set mail_account, o365_application_id and telegram_chat_id in Settings')
  let revision = context.input.checkpointRevision
  let state = context.input.checkpoint
  const finish = summary => ({ status: 'completed', summary, completedInputIds: context.input.eventIds, gapIds: [] })
  async function commit(next) {
    const reply = await context.progress.commit({ expectedRevision: revision, checkpoint: next, sources: [], claims: [] })
    revision = reply.revision
    state = next
  }
  async function deliverPending() {
    const token = await context.credentials.get('telegram_bot_token')
    if (!/^\d+:[\w-]+$/.test(token)) throw new Error('Set a valid telegram_bot_token secret')
    const reply = await context.http.request({ url: `https://api.telegram.org/bot${token}/sendMessage`, method: 'POST', key: state.pending.key, headers: { 'content-type': 'application/json' }, body: state.pending.body })
    if (reply.status !== 200 || (reply.headers['x-pods-reconciled'] !== 'owner' && JSON.parse(reply.body).ok !== true)) throw new Error('Telegram did not confirm delivery; review History before retrying')
    await commit({ version: 1, initialized: true, ...state.pending.next })
  }
  if (state.pending) {
    await deliverPending()
    return finish('Pending mail notification completed')
  }
  const checkedAt = new Date().toISOString()
  const since = new Date(state.checkedAt ? Date.parse(state.checkedAt) - 5 * 60000 : Date.parse(checkedAt) - 24 * 3600000).toISOString()
  const messages = new Map()
  let cursor
  for (let page = 0; page < 20; page++) {
    const argv = ['pods', 'read', '--account', account, '--folder', 'inbox', '--operation', 'messages', '--since', since, ...(cursor ? ['--cursor', cursor] : [])]
    const reply = await context.tools.invoke({ applicationId, argv })
    if (reply.exitCode !== 0) throw new Error('Mail read failed; inspect the assigned application in Permissions')
    const result = JSON.parse(reply.stdout)
    if (result.account !== account || result.operation !== 'messages' || !Array.isArray(result.items)) throw new Error('Mail reply does not match the configured account and operation')
    for (const item of result.items) {
      if (typeof item.id !== 'string' || !item.id) throw new Error('Mail reply is missing a stable message identity')
      messages.set(fingerprint(item.id), true)
      if (messages.size > maximumMessages) throw new Error('Mail window exceeds 1000 messages; narrow the script window before retrying')
    }
    if (result.complete === true) break
    if (page === 19 || typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor === cursor) throw new Error('Mail pagination did not complete')
    cursor = result.nextCursor
  }
  const previous = new Set(state.seen ?? [])
  const newIds = [...messages.keys()].filter(id => !previous.has(id)).sort()
  const next = { checkedAt, seen: [...new Set([...(state.seen ?? []), ...messages.keys()])].slice(-1500) }
  if (!state.initialized || !newIds.length) {
    const initialized = state.initialized
    await commit({ version: 1, initialized: true, ...next })
    return finish(initialized ? 'No new mail' : 'Mail baseline saved; future new mail will be reported')
  }
  const text = language === 'en' ? `${newIds.length} new email(s) in ${account}.` : `${newIds.length} neue E-Mail(s) in ${account}.`
  const key = `mail:${fingerprint(JSON.stringify([account, newIds]))}`
  await commit({ ...state, pending: { key, body: JSON.stringify({ chat_id: chatId, text }), next } })
  await deliverPending()
  return finish(`Reported ${newIds.length} new email(s)`)
}
