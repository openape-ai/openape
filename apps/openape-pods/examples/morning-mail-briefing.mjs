import { writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const timezone = 'Europe/Vienna'
const accounts = ['phofmann@delta-mind.at', 'patrick@docpit.eu']
const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const shortDays = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']

function parts(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid source timestamp')
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]))
  return { ...fields, dayKey: `${fields.year}-${fields.month}-${fields.day}`,
    weekday: new Date(`${fields.year}-${fields.month}-${fields.day}T12:00:00Z`).getUTCDay() }
}

function readArray(result, label) {
  if (result.exitCode !== 0) throw new Error(`${label}: CLI failed (exit ${result.exitCode}); check Pod login and permissions`)
  let value
  try { value = JSON.parse(result.stdout) }
  catch { throw new Error(`${label}: CLI did not return JSON`) }
  if (value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}: expected an array`)
  return value
}

function calendarLine(event, upcoming) {
  if (typeof event.subject !== 'string') throw new Error('Calendar event has no subject')
  const start = parts(event.start)
  const time = event.is_all_day ? 'ganztags' : `${start.hour}:${start.minute}`
  if (upcoming) return `- ${shortDays[start.weekday]} ${start.day}.${start.month}. ${time} ${event.subject}`
  const end = parts(event.end)
  return `- ${event.is_all_day ? 'ganztags' : `${time}-${end.hour}:${end.minute}`} ${event.subject}`
}

function readIssues(result) {
  if (result.exitCode !== 0) throw new Error('Repos issues: CLI failed; check Pod authentication and permissions')
  let value
  try { value = JSON.parse(result.stdout) }
  catch { throw new Error('Repos issues: CLI did not return JSON') }
  if (value?.scope !== 'owned:patrick' || !Number.isSafeInteger(value.total) || value.total < 0 ||
      !Array.isArray(value.issues) || value.issues.length !== Math.min(10, value.total)) {
    throw new Error('Repos issues: invalid result')
  }
  for (const issue of value.issues) {
    if (typeof issue.title !== 'string' || !/^patrick\/[\w.-]+$/.test(issue.repository) ||
        !Number.isSafeInteger(issue.number) || issue.number < 1 ||
        issue.url !== `https://repos.openape.ai/${issue.repository}/issues/${issue.number}`) {
      throw new Error('Repos issues: invalid issue')
    }
  }
  return value
}

export function render(now, data, mailReview) {
  const today = parts(now)
  const lines = [`📅 ${weekdays[today.weekday]}, ${Number(today.day)}.${today.month}.${today.year}`, '']
  const events = data.flatMap(item => item.today ?? [])
  lines.push(events.length ? '🗓 Termine heute' : '🗓 Keine Termine heute')
  lines.push(...events.map(event => calendarLine(event, false)))
  const repos = data.find(item => item.repos).repos
  lines.push('', `🛠 Offene Repos-Issues: ${repos.total}`)
  if (repos.total > 0) {
    lines.push(`${Math.min(3, repos.issues.length)} zuletzt aktualisiert:`)
    for (const issue of repos.issues.slice(0, 3)) {
      const title = issue.title.replace(/\s+/g, ' ').trim()
      const shortTitle = title.length > 120 ? `${title.slice(0, 119)}…` : title
      lines.push(`- ${issue.repository} #${issue.number}: ${shortTitle}`, `  ${issue.url}`)
    }
    if (repos.total > Math.min(3, repos.issues.length)) lines.push(`Weitere ${repos.total - Math.min(3, repos.issues.length)} offene Issues in deinen Repositories.`)
  }
  lines.push('', '📬 Mails')
  if (!mailReview || mailReview.date !== today.dayKey || !Array.isArray(mailReview.accounts) || !Array.isArray(mailReview.gaps)) throw new Error('Current workflow mail review is missing')
  for (const item of mailReview.accounts) {
    lines.push(`${item.account}: ${item.checked}/${item.total} Inbox-Mails geprüft`)
    for (const mail of item.important.slice(0, 2)) {
      const compact = value => value.replace(/\s+/g, ' ').trim()
      lines.push(`- ${mail.disposition === 'action' ? 'Handlungsbedarf' : 'Behalten'}: ${compact(mail.subject).slice(0, 60)} (${mail.sender})`, `  ${compact(mail.summary).slice(0, 130)}`)
      if (mail.nextAction) lines.push(`  Nächster Schritt: ${compact(mail.nextAction).slice(0, 90)}`)
    }
    if (item.grant?.count < item.archiveCount) lines.push(`${item.archiveCount - item.grant.count} weitere Archivierungsvorschläge bleiben vorerst in der Inbox.`)
    if (item.grant?.url) lines.push(`${item.grant.count} Mails zum Archivieren vorgeschlagen → Prüfen und freigeben:`, item.grant.url)
    else if (item.archiveCount) lines.push(`${item.archiveCount} Archivierungsvorschläge${mailReview.preview ? ' (Vorschau; noch kein Grant)' : '; Freigabe nicht verfügbar'}.`)
  }
  for (const gap of mailReview.gaps) lines.push(`⚠ ${gap}`)
  const next = data.flatMap(item => item.upcoming ?? []).filter(event => parts(event.start).dayKey > today.dayKey)
  lines.push('', next.length ? '📆 Nächste 7 Tage' : '📆 Nächste 7 Tage: ruhig')
  lines.push(...next.map(event => calendarLine(event, true)))
  const text = lines.join('\n')
  if (text.length > 4096) throw new Error('Briefing exceeds Telegram message limit; no partial delivery')
  return text
}

async function save(workspace, name, value) {
  const path = join(workspace, name)
  await writeFile(`${path}.tmp`, value, { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

export async function run(context) {
  const result = (status, summary, gapIds = []) => ({ status, summary, gapIds, completedInputIds: context.input.eventIds })
  let revision = context.input.checkpointRevision
  let state = context.input.checkpoint
  const commit = async (next) => {
    revision = (await context.progress.commit({ expectedRevision: revision, checkpoint: next, sources: [], claims: [] })).revision
    state = next
  }
  const gap = async (text) => {
    const id = `briefing-${context.input.runId}`
    revision = (await context.progress.commit({ expectedRevision: revision, checkpoint: state,
      sources: [{ id, locator: 'calendar-briefing:runtime-check', version: context.input.runId, content: text }],
      claims: [{ id, matter: 'Morning briefing readiness', kind: 'gap', text, sourceIds: [id] }] })).revision
    return result('completedWithGaps', text, [id])
  }
  const now = new Date()
  const date = parts(now).dayKey
  const chatId = context.variables.calendar_chat_id
  const mode = context.variables.delivery_mode
  if (!/^\d+$/.test(chatId ?? '') || !['preview', 'live'].includes(mode)) return gap('Missing verified destination or delivery mode; no send')
  if (!state?.version) {
    let seed
    try { seed = JSON.parse(context.variables.migration_seed) }
    catch { return gap('Missing valid migration delivery state; no send') }
    if (seed.version !== 1 || seed.delivery?.chatId !== chatId || seed.delivery?.status !== 'sent' || !/^\d{4}-\d{2}-\d{2}$/.test(seed.lastDeliveredDate)) return gap('Migration receipt does not match the destination; no send')
    await commit(seed)
  }
  const deliver = mode === 'live' && context.input.reason === 'schedule'
  if (deliver && state.pending) return gap('Previous delivery is pending or uncertain; reconcile Telegram evidence before any new send')
  if (deliver && date <= state.lastDeliveredDate) return result('completed', `Already delivered for ${date}; no Telegram request`)
  await mkdir(context.workspace, { recursive: true })
  const errors = []
  let token
  try {
    token = await context.credentials.get('calendar_bot_token')
    const response = await context.http.request({ url: `https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`, method: 'GET', headers: {} })
    const body = JSON.parse(response.body)
    if (response.status !== 200 || body.ok !== true || String(body.result?.id) !== chatId) errors.push('Telegram target/authentication not confirmed')
  }
  catch { errors.push('Telegram read-only target check failed; inspect assigned credential and permission') }
  const data = []
  for (const account of accounts) {
    const item = { account }
    for (const [field, argv] of [
      ['today', ['calendar', 'today', '--account', account, '--json']],
      ['upcoming', ['calendar', 'list', '--account', account, '--days', '8', '--limit', '50', '--json']],
    ]) {
      try { item[field] = readArray(await context.tools.invoke({ application: 'o365-cli', argv }), `${account}/${field}`) }
      catch (error) { errors.push(error instanceof Error && error.message.startsWith(account) ? error.message : `${account}/${field}: Pod application call failed`) }
    }
    data.push(item)
  }
  try { data.push({ repos: readIssues(await context.tools.invoke({ application: 'repos-issues', argv: ['list'] })) }) }
  catch (error) { errors.push(error instanceof Error && error.message.startsWith('Repos issues') ? error.message : 'Repos issues: Pod application call failed') }
  if (errors.length) return gap(`No send. ${errors.join('; ')}`)
  const mailReview = Object.values(context.input.workflow?.outputs ?? {}).find(output => output.schema === 'morning-mail-review/v1')?.data
  let text
  try { text = render(now, data, mailReview) }
  catch (error) { return gap(error.message) }
  if (parts(new Date()).dayKey !== date) return gap('Local date changed during collection; no send')
  await save(context.workspace, 'preview.txt', `${text}\n`)
  await save(context.workspace, 'source-snapshot.json', JSON.stringify({ date, collectedAt: new Date().toISOString(), data, mailReview }))
  await commit({ ...state, lastPreview: { date, runId: context.input.runId, sourceCount: 6, targetConfirmed: true, characters: text.length } })
  if (!deliver) return result('completed', `Live-source preview saved to workspace/preview.txt (${text.length} characters); Telegram target confirmed; no send`)
  const key = `calendar-briefing:${chatId}:${date}`
  await commit({ ...state, pending: { key, date, text, chatId, preparedAt: new Date().toISOString() } })
  let reply
  try {
    reply = await context.http.request({ url: `https://api.telegram.org/bot${token}/sendMessage`, method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }), key, receipt: 'digest' })
  }
  catch { return gap('Telegram delivery result is uncertain; pending key retained, automatic resend prohibited') }
  let body
  try { body = JSON.parse(reply.body) }
  catch { return gap('Telegram receipt needs reconciliation; no resend') }
  if (reply.status !== 200 || body.ok !== true || String(body.result?.chat?.id) !== chatId || !Number.isSafeInteger(body.result?.message_id)) return gap('Telegram did not provide a matching delivery receipt; no resend')
  const delivery = { date, status: 'sent', key, messageId: body.result.message_id, telegramDate: body.result.date, chatId, source: 'pod-telegram-response', runId: context.input.runId }
  await save(context.workspace, `delivery-${date}.json`, `${JSON.stringify(delivery, null, 2)}\n`)
  await commit({ ...state, lastDeliveredDate: date, delivery, pending: null })
  return result('completed', `Telegram delivery confirmed for ${date}; message ${delivery.messageId}; key ${key}`)
}
