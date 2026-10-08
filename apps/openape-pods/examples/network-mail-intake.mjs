import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export const baselineConfiguration = { 'mailbox': 'phofmann@delta-mind.at', 'preview-root': '/Users/patrickhofmann/Library/Application Support/OpenApe M9 Preview/delta', 'delivery-mode': 'preview', 'max-messages': '3' }
export const contract = { takes: [], gives: ['mail.open', 'mail.sent-raw'], summary: 'Reads versioned mail previews' }
// Triage evaluates each mail with Jev, whose assignment allows 9 attempts per run; four new mails leave room for retries.
const perRun = { 'mail.open': 4, 'mail.sent-raw': 2 }
// Owner-approved backlog bound (plan 01M4EDTC): inbox mail of the last 30 days; sent mail only feeds Memory.
const window = { 'mail.open': 30 * 86400000, 'mail.sent-raw': 2 * 86400000 }
// One listing must stay below the 256 KiB tool output bound; 100 rows are about 110 KiB.
const listLimit = '100'
// As before the cursor, the newest known mails are re-read so that a real content change is still asked again.
const recheck = 3
const fingerprint = value => createHash('sha256').update(value).digest('hex')
// eslint-disable-next-line no-control-regex
const clean = (value, limit) => String(value ?? '').replace(/[\x00-\x1F\u202A-\u202E\u2066-\u2069]/g, ' ').slice(0, limit)
const address = value => value?.emailAddress?.address?.trim().toLowerCase() ?? ''
function plain(value) { const text = String(value ?? '').trim().toLowerCase(); return /<([^\s<>][^\s<>@]*@[^\s<>]+)>$/.exec(text)?.[1] ?? (/^[^\s<>][^\s<>@]*@[^\s<>]+$/.test(text) ? text : '') }
// Outlook changes the changeKey when a mail is read, flagged or categorised; only a content change is a new version.
const contentVersion = mail => `content:${fingerprint(JSON.stringify([address(mail.from), mail.toRecipients.map(address), mail.ccRecipients.map(address), mail.subject, mail.receivedDateTime, mail.body.content, mail.hasAttachments === true]))}`
const seenLimit = 400
const seenKey = (channel, mail) => fingerprint(JSON.stringify([channel, mail.id, contentVersion(mail)]))

async function invoke(context, argv) {
  const response = await context.tools.invoke({ application: 'o365-cli', argv })
  if (response.exitCode !== 0) throw new Error('Assigned mailbox read failed; inspect program activity')
  return JSON.parse(response.stdout)
}

async function listing(context, account, folder) {
  const rows = await invoke(context, ['mail', 'list', '--account', account, '--folder', folder, '--limit', listLimit, '--json'])
  if (!Array.isArray(rows) || rows.some(row => row.account !== account || typeof row.message_id !== 'string' || !row.message_id || !Number.isFinite(Date.parse(row.date)))) throw new Error('Invalid mailbox listing')
  return rows
}

async function read(context, account, row) {
  const reply = await invoke(context, ['workflow', 'read', '--account', account, '--message', row.message_id])
  if (reply.protocol !== 'pods-mail/v1' || reply.account !== account || reply.operation !== 'read' || reply.outcome !== 'confirmed' || !Array.isArray(reply.items) || reply.items.length !== 1) throw new Error('Provider identity read is incomplete or belongs to another account')
  const mail = reply.items[0]
  if (typeof mail.id !== 'string' || !mail.id || mail.id.length > 200 || typeof mail.changeKey !== 'string' || !mail.changeKey || mail.changeKey.length > 200 || typeof mail.subject !== 'string' || !Number.isFinite(Date.parse(mail.receivedDateTime)) || typeof mail.body?.content !== 'string' || !['text', 'html'].includes(mail.body.contentType) || !address(mail.from) || !Array.isArray(mail.toRecipients) || !Array.isArray(mail.ccRecipients)) throw new Error('Provider omitted a stable identity, version or required mail fields')
  return mail
}

// Every mail the network already received has an evidence record with its content version.
async function emittedMail(root, account) {
  const known = new Map()
  for (const name of await readdir(root).catch((error) => { if (error.code === 'ENOENT') return []; throw error })) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
    const record = JSON.parse(await readFile(join(root, name), 'utf8'))
    if (record.account !== account) continue
    for (const key of [record.messageId, record.internetMessageId]) {
      if (typeof key === 'string' && key) known.set(key, new Set([...(known.get(key) ?? []), record.version]))
    }
  }
  return known
}

function baseline(checkpoint, account) {
  if (checkpoint.version !== 1 || checkpoint.account !== account || checkpoint.scope !== 'latest-three-inbox-and-sent' || !Array.isArray(checkpoint.observed) || checkpoint.observed.length > 6 || !Array.isArray(checkpoint.initial) || checkpoint.initial.length > 6 || typeof checkpoint.recordedAt !== 'string' || !Number.isFinite(Date.parse(checkpoint.recordedAt))) throw new Error('Review the exact bounded provider baseline before network processing')
  if (checkpoint.seen !== undefined && (!Array.isArray(checkpoint.seen) || checkpoint.seen.length > seenLimit || checkpoint.seen.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)))) throw new Error('Invalid provider baseline item')
  for (const item of [...checkpoint.observed, ...checkpoint.initial]) {
    if (!contract.gives.includes(item.channel) || typeof item.id !== 'string' || !item.id || typeof item.version !== 'string' || !item.version) throw new Error('Invalid provider baseline item')
  }
  return checkpoint
}

export async function run(context) {
  const values = context.network ? { ...context.variables, ...Object.fromEntries(Object.entries(context.config).map(([name, field]) => [name, field.value])) } : { ...baselineConfiguration, ...context.variables }
  const account = values.mailbox
  const root = values['preview-root']
  if (typeof account !== 'string' || !/^[^\s@]+@[^\s.@]+\.[^\s@]+$/.test(account) || typeof root !== 'string' || !root.startsWith('/') || !['preview', 'live'].includes(values['delivery-mode'])) throw new Error('Configure the exact mailbox, evidence directory and delivery mode')
  if (!context.network) return { status: 'completed', summary: 'The mailbox cursor reads and emits only inside the reviewed mail network; nothing was read.', completedInputIds: context.input.eventIds, gapIds: [] }
  const previous = baseline(context.input.checkpoint, account)
  const now = Date.now()
  const [inbox, sent] = [await listing(context, account, 'Inbox'), await listing(context, account, 'sentitems')]
  const contacts = new Set(sent.flatMap(row => [...(row.to ?? []), ...(row.cc ?? [])]).map(plain).filter(Boolean))
  const known = await emittedMail(root, account)
  await mkdir(root, { recursive: true })
  const observed = []; let emitted = 0; let waiting = 0
  for (const [channel, rows] of [['mail.open', inbox], ['mail.sent-raw', sent]]) {
    const isKnown = row => known.has(row.message_id) || (row.internet_message_id && known.has(row.internet_message_id))
    const fresh = rows.filter(row => now - Date.parse(row.date) <= window[channel] && !isKnown(row))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    waiting += Math.max(0, fresh.length - perRun[channel])
    for (const row of [...fresh.slice(0, perRun[channel]), ...(channel === 'mail.open' ? rows.slice(0, recheck).filter(isKnown) : [])]) {
      const mail = await read(context, account, row)
      const version = contentVersion(mail)
      const versions = known.get(mail.id) ?? known.get(mail.internetMessageId)
      // Evidence written before content versions holds a changeKey; such a mail counts as seen.
      if (versions && (versions.has(version) || ![...versions].some(known => known.startsWith('content:')))) continue
      observed.push({ channel, id: mail.id, version })
      if (previous.seen?.includes(seenKey(channel, mail))) continue
      const record = { account, messageId: mail.id, version, internetMessageId: mail.internetMessageId ?? '', sender: clean(address(mail.from), 300), subject: clean(mail.subject, 500), date: mail.receivedDateTime, to: mail.toRecipients.map(address), body: mail.body.content.slice(0, 6000), complete: mail.body.content.length <= 6000 && mail.hasAttachments !== true, knownContact: contacts.has(address(mail.from)), attachmentMetadata: [], hasAttachments: mail.hasAttachments === true, providerVersionAvailable: true }
      const raw = JSON.stringify(record)
      const evidence = fingerprint(raw)
      await writeFile(join(root, `${evidence}.json`), raw, { mode: 0o600 })
      const payload = { account, evidence, sender: clean(record.sender, 120), subject: clean(mail.subject, 160), date: mail.receivedDateTime, complete: record.complete, knownContact: record.knownContact }
      await context.network.emit({ channel, key: fingerprint(JSON.stringify([account, mail.id, version])), sourceItemId: mail.id, sourceVersion: version, payload })
      known.set(mail.id, new Set([...(versions ?? []), version])); emitted++
    }
  }
  const recent = observed.map(item => fingerprint(JSON.stringify([item.channel, item.id, item.version])))
  await context.progress.commit({ expectedRevision: context.input.checkpointRevision, checkpoint: { ...previous, observed: observed.slice(0, 6), seen: [...new Set([...recent, ...(previous.seen ?? [])])].slice(0, seenLimit) }, sources: [], claims: [] })
  return { status: 'completed', summary: `Listed ${inbox.length} inbox and ${sent.length} sent messages, emitted ${emitted} new mails; ${waiting} more wait for the next runs. No mailbox writes.`, completedInputIds: context.input.eventIds, gapIds: [] }
}
