import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export const baselineConfiguration = {}
export const contract = { takes: [], gives: ['mail.open', 'mail.sent-raw'], summary: 'Reads versioned mail previews' }
const fingerprint = value => createHash('sha256').update(value).digest('hex')
// eslint-disable-next-line no-control-regex
const clean = (value, limit) => String(value ?? '').replace(/[\x00-\x1F\u202A-\u202E\u2066-\u2069]/g, ' ').slice(0, limit)
const address = value => value?.emailAddress?.address?.trim().toLowerCase() ?? ''

async function invoke(context, argv) {
  const response = await context.tools.invoke({ application: 'o365-cli', argv })
  if (response.exitCode !== 0) throw new Error('Assigned mailbox read failed; inspect program activity')
  return JSON.parse(response.stdout)
}

async function sample(context, account, folder) {
  const rows = await invoke(context, ['mail', 'list', '--account', account, '--folder', folder, '--limit', '3', '--json'])
  if (!Array.isArray(rows) || rows.length > 3 || rows.some(mail => mail.account !== account || typeof mail.message_id !== 'string' || !mail.message_id)) throw new Error('Invalid bounded mailbox sample')
  const messages = []
  for (const row of rows) {
    const reply = await invoke(context, ['workflow', 'read', '--account', account, '--message', row.message_id])
    if (reply.protocol !== 'pods-mail/v1' || reply.account !== account || reply.operation !== 'read' || reply.outcome !== 'confirmed' || !Array.isArray(reply.items) || reply.items.length !== 1) throw new Error('Provider identity read is incomplete or belongs to another account')
    const mail = reply.items[0]
    if (typeof mail.id !== 'string' || !mail.id || mail.id.length > 200 || typeof mail.changeKey !== 'string' || !mail.changeKey || mail.changeKey.length > 200 || typeof mail.subject !== 'string' || !Number.isFinite(Date.parse(mail.receivedDateTime)) || typeof mail.body?.content !== 'string' || !['text', 'html'].includes(mail.body.contentType) || !address(mail.from) || !Array.isArray(mail.toRecipients) || !Array.isArray(mail.ccRecipients)) throw new Error('Provider omitted a stable identity, version or required mail fields')
    if (messages.some(previous => previous.id === mail.id)) throw new Error('Provider repeated an immutable identity in one folder sample')
    messages.push(mail)
  }
  return messages
}

function baseline(checkpoint, account) {
  if (checkpoint.version !== 1 || checkpoint.account !== account || checkpoint.scope !== 'latest-three-inbox-and-sent' || !Array.isArray(checkpoint.observed) || checkpoint.observed.length > 6 || !Array.isArray(checkpoint.initial) || checkpoint.initial.length > 6 || typeof checkpoint.recordedAt !== 'string' || !Number.isFinite(Date.parse(checkpoint.recordedAt))) throw new Error('Review the exact bounded provider baseline before network processing')
  for (const item of [...checkpoint.observed, ...checkpoint.initial]) {
    if (!contract.gives.includes(item.channel) || typeof item.id !== 'string' || !item.id || typeof item.version !== 'string' || !item.version) throw new Error('Invalid provider baseline item')
  }
  return checkpoint
}

export async function run(context) {
  const values = context.network ? { ...context.variables, ...Object.fromEntries(Object.entries(context.config).map(([name, field]) => [name, field.value])) } : { ...baselineConfiguration, ...context.variables }
  const account = values.mailbox
  const root = values['preview-root']
  if (typeof account !== 'string' || !/^[^\s@]+@[^\s.@]+\.[^\s@]+$/.test(account) || typeof root !== 'string' || !root.startsWith('/') || values['delivery-mode'] !== 'preview' || values['max-messages'] !== '3') throw new Error('Configure the exact mailbox, evidence directory and three-message preview boundary')
  const previous = context.network ? baseline(context.input.checkpoint, account) : null
  const inbox = await sample(context, account, 'Inbox')
  const sent = await sample(context, account, 'sentitems')
  const folders = [['mail.open', inbox], ['mail.sent-raw', sent]]
  const observed = folders.flatMap(([channel, messages]) => messages.map(mail => ({ channel, id: mail.id, version: mail.changeKey })))
  if (!context.network) {
    if (context.input.checkpointRevision !== 0 || Object.keys(context.input.checkpoint).length) throw new Error('An existing baseline must be reviewed; this script cannot overwrite it outside the network')
    const checkpoint = { version: 1, account, scope: 'latest-three-inbox-and-sent', recordedAt: new Date().toISOString(), initial: observed, observed }
    await context.progress.commit({ expectedRevision: context.input.checkpointRevision, checkpoint, sources: [], claims: [] })
    return { status: 'completed', summary: `Recorded the provider identities and versions of ${observed.length} sampled messages as the initial boundary. Emitted 0 items. This is a bounded sample, not a full mailbox cursor.`, completedInputIds: context.input.eventIds, gapIds: [] }
  }
  const contacts = new Set(sent.flatMap(mail => [...mail.toRecipients, ...mail.ccRecipients]).map(address).filter(Boolean))
  await mkdir(root, { recursive: true })
  let emitted = 0
  for (const [channel, messages] of folders) {
    for (const mail of messages) {
      if ([...previous.initial, ...previous.observed].some(item => item.channel === channel && item.id === mail.id && item.version === mail.changeKey)) continue
      const record = { account, messageId: mail.id, version: mail.changeKey, internetMessageId: mail.internetMessageId ?? '', sender: clean(address(mail.from), 300), subject: clean(mail.subject, 500), date: mail.receivedDateTime, to: mail.toRecipients.map(address), body: mail.body.content.slice(0, 6000), complete: mail.body.content.length <= 6000 && mail.hasAttachments !== true, knownContact: contacts.has(address(mail.from)), attachmentMetadata: [], hasAttachments: mail.hasAttachments === true, providerVersionAvailable: true }
      const raw = JSON.stringify(record)
      const evidence = fingerprint(raw)
      await writeFile(join(root, `${evidence}.json`), raw, { mode: 0o600 })
      const payload = { account, evidence, sender: clean(record.sender, 120), subject: clean(mail.subject, 160), date: mail.receivedDateTime, complete: record.complete, knownContact: record.knownContact }
      await context.network.emit({ channel, key: fingerprint(JSON.stringify([account, mail.id, mail.changeKey])), sourceItemId: mail.id, sourceVersion: mail.changeKey, payload })
      emitted++
    }
  }
  await context.progress.commit({ expectedRevision: context.input.checkpointRevision, checkpoint: { ...previous, observed }, sources: [], claims: [] })
  return { status: 'completed', summary: `Read ${observed.length} sampled messages and emitted ${emitted} changed provider versions. No mailbox writes. Sent contacts remain a partial sample.`, completedInputIds: context.input.eventIds, gapIds: [] }
}
