import { writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const timezone = 'Europe/Vienna'
const accounts = ['phofmann@delta-mind.at', 'patrick@docpit.eu']

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

async function save(workspace, name, value) {
  const path = join(workspace, name)
  await writeFile(`${path}.tmp`, value, { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

function safeLink(value) {
  if (!value) return undefined
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsafe source URL; publication stopped')
  return value
}

export function buildBriefing(now, seriesId, data, mailReview, preview) {
  const editionDate = parts(now).dayKey
  if (!mailReview || mailReview.date !== editionDate || !Array.isArray(mailReview.accounts) || !Array.isArray(mailReview.gaps)) throw new Error('Current workflow mail review is missing')
  const generatedAt = now.toISOString()
  const report = { schemaVersion: 1, type: 'briefing', seriesId, editionDate, timezone, generatedAt,
    title: preview ? 'Morgenbericht · Vorschau' : 'Dein Morgenbericht', overview: '',
    importantItems: [], nextActions: [], calendar: [], emails: [], issues: [], sources: [], gaps: [] }
  for (const item of data.filter(item => item.account)) {
    const sourceId = `calendar-${report.sources.length}`
    const failed = item.errors.length > 0
    report.sources.push({ id: sourceId, label: `Kalender · ${item.account}`, collectedAt: generatedAt, status: failed ? 'partial' : 'fresh', coverage: 'Heute und die nächsten sieben Tage; maximal 50 kommende Termine.', limit: 50 })
    for (const reason of item.errors) report.gaps.push({ sourceId, reason })
    const events = new Map()
    for (const event of [...(item.today ?? []), ...(item.upcoming ?? [])]) events.set(event.id, event)
    if ((item.upcoming?.length ?? 0) >= 50) {
      report.sources.at(-1).status = 'partial'
      report.gaps.push({ sourceId, reason: 'Die Erfassungsgrenze für kommende Termine wurde erreicht; spätere Termine können fehlen.' })
    }
    report.sources.at(-1).total = events.size
    for (const event of events.values()) {
      if (typeof event.subject !== 'string' || typeof event.id !== 'string') throw new Error('Calendar event has no identity or title')
      report.calendar.push({ id: event.id, account: item.account, title: event.subject || '(Termin ohne Titel)',
        start: event.is_all_day ? parts(event.start).dayKey : new Date(event.start).toISOString(),
        end: event.is_all_day ? parts(event.end).dayKey : new Date(event.end).toISOString(),
        allDay: event.is_all_day === true, location: event.location || '', ...(event.url ? { url: safeLink(event.url) } : {}) })
    }
  }
  const mailCollected = new Date(mailReview.collectedAt)
  if (!Number.isFinite(mailCollected.getTime())) throw new Error('Mail review has no collection timestamp')
  const staleMail = now.getTime() - mailCollected.getTime() > 2 * 60 * 60 * 1000
  for (const item of mailReview.accounts) {
    const sourceId = `mail-${report.sources.length}`
    const status = staleMail ? 'stale' : item.checked < item.total ? 'partial' : 'fresh'
    report.sources.push({ id: sourceId, label: `Mail-Prüfung · ${item.account}`, collectedAt: mailReview.collectedAt, status,
      coverage: `${item.checked}/${item.total} Nachrichten im Posteingang geprüft. ${item.archiveCount} Archivierungsvorschläge.${preview ? ' Vorschau: Es wurde keine Archivierungsfreigabe erstellt.' : ' Archivierungen benötigen weiterhin deine ausdrückliche Freigabe.'}`,
      total: item.total, limit: item.checked, ...(item.grant?.url ? { approvalUrl: safeLink(item.grant.url), approvalCount: item.grant.count } : {}) })
    if (staleMail) report.gaps.push({ sourceId, reason: 'Die Mail-Prüfung ist mehr als zwei Stunden alt.' })
    if (item.checked < item.total) report.gaps.push({ sourceId, reason: `${item.total - item.checked} Nachrichten wurden in dieser Prüfung nicht erfasst.` })
    for (const mail of item.important) {
      report.emails.push({ id: mail.id, account: item.account, sender: mail.sender, subject: mail.subject || '(Ohne Betreff)', receivedAt: new Date(mail.receivedAt).toISOString(), disposition: mail.disposition,
        summary: mail.summary, nextAction: mail.nextAction || '', url: safeLink(mail.url) })
    }
  }
  const reviewId = 'mail-review-coverage'
  report.sources.push({ id: reviewId, label: 'Abdeckung der Mail-Prüfung', collectedAt: mailReview.collectedAt, status: mailReview.gaps.length ? 'partial' : 'fresh', coverage: 'Ergebnisse der vorhandenen Mail-Prüfung.' })
  for (const reason of mailReview.gaps) report.gaps.push({ sourceId: reviewId, reason })
  const repos = data.find(item => item.repos)?.repos
  report.sources.push({ id: 'issues', label: 'Offene Repository-Issues', collectedAt: generatedAt, status: repos ? (repos.total > 10 ? 'partial' : 'fresh') : 'missing', coverage: 'Patricks Repositories; bis zu zehn zuletzt aktualisierte offene Issues.', ...(repos ? { total: repos.total } : {}), limit: 10, url: 'https://repos.openape.ai/issues' })
  if (!repos) report.gaps.push({ sourceId: 'issues', reason: data.find(item => item.reposError)?.reposError || 'Repository-Issues konnten nicht erfasst werden.' })
  for (const issue of repos?.issues ?? []) report.issues.push({ repository: issue.repository, number: issue.number, title: issue.title, state: 'open', updatedAt: new Date(issue.updatedAt).toISOString(), url: safeLink(issue.url) })
  const todayEvents = report.calendar.filter(event => parts(event.start).dayKey === editionDate).length
  report.overview = `${todayEvents} ${todayEvents === 1 ? 'Termin' : 'Termine'} heute, ${report.emails.length} relevante Nachrichten und ${repos ? repos.total : 'nicht verfügbare'} offene Repository-Issues. ${report.emails.filter(mail => mail.nextAction).length} nächste Schritte stehen bei den jeweiligen Nachrichten.${report.gaps.length ? ` Bitte beachte ${report.gaps.length} Hinweise zur Quellenabdeckung.` : ''}`
  const body = JSON.stringify(report)
  if (Buffer.byteLength(body) > 60 * 1024) throw new Error('Briefing exceeds the 60 KiB publication limit; no partial publication')
  return report
}

function verifyPublication(reply, pending, origin) {
  if (reply.status !== 200 && reply.status !== 201) throw new Error(`Reports returned HTTP ${reply.status}`)
  const receipt = JSON.parse(reply.body)
  const url = new URL(receipt.url)
  if (receipt.digest !== pending.digest || typeof receipt.id !== 'string' || !Number.isSafeInteger(receipt.version) || receipt.version < 1
    || url.origin !== origin || !/^\/r\/[\w-]+$/.test(url.pathname) || url.search || url.hash
    || receipt.edition_url !== `${receipt.url}?v=${receipt.version}`) {
    throw new Error('Publication receipt does not match the frozen briefing')
  }
  return { id: receipt.id, digest: receipt.digest, version: receipt.version, url: receipt.url, edition_url: receipt.edition_url }
}

export async function publish(context, pending, origin) {
  const receiptUrl = `${origin}/api/report-series/${pending.seriesId}/editions/${pending.date}/publication`
  let reply = await context.http.request({ url: receiptUrl, method: 'GET', headers: {} })
  if (reply.status === 404) {
    reply = await context.http.request({ url: `${origin}/api/reports`, method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': pending.key }, body: pending.body, key: `${pending.key}:${pending.attempt ?? 0}`, receipt: 'digest' })
    if (reply.status >= 500) throw Object.assign(new Error(`Reports returned HTTP ${reply.status}`), { retryablePublicationResponse: true })
    if (reply.status !== 200 && reply.status !== 201) throw new Error(`Reports returned HTTP ${reply.status}`)
    reply = await context.http.request({ url: receiptUrl, method: 'GET', headers: {} })
  }
  return verifyPublication(reply, pending, origin)
}

export function notification(date, publication, report) {
  const lines = [`📅 Morgenbericht · ${date}`, '', 'Dein privater Morgenbericht:', publication.edition_url, '', `Neueste Ausgabe: ${publication.url}`]
  for (const source of report.sources) {
    if (source.approvalUrl) lines.push('', `${source.approvalCount} Archivierungsvorschläge · prüfen und freigeben:`, source.approvalUrl)
  }
  if (report.gaps.length) lines.push('', `⚠ ${report.gaps.length} Hinweise zur Quellenabdeckung findest du im Bericht.`)
  const text = lines.join('\n')
  if (text.length > 4096) throw new Error('Notification exceeds Telegram limit; no partial send')
  return text
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
  const now = new Date(); const date = parts(now).dayKey
  const chatId = context.variables.calendar_chat_id
  const mode = context.variables.delivery_mode
  const publicationMode = context.variables.publication_mode
  const origin = context.variables.reports_url
  if (!/^\d+$/.test(chatId ?? '') || !['preview', 'live'].includes(mode) || !['preview', 'live'].includes(publicationMode) || origin !== 'https://report.openape.ai') return gap('Missing verified Reports configuration or delivery mode; no publication or send')
  const deliver = mode === 'live' && publicationMode === 'live' && context.input.reason === 'schedule'
  const seriesId = deliver ? context.variables.reports_series_id : context.variables.reports_preview_series_id
  if (!/^[A-Z0-9]{26}$/.test(seriesId ?? '') || context.variables.reports_series_id === context.variables.reports_preview_series_id) return gap('Distinct live and preview series are required; no publication or send')
  if (!state?.version) {
    let seed
    try { seed = JSON.parse(context.variables.migration_seed) }
    catch { return gap('Missing valid migration delivery state; no send') }
    if (seed.version !== 1 || seed.delivery?.chatId !== chatId || seed.delivery?.status !== 'sent' || !/^\d{4}-\d{2}-\d{2}$/.test(seed.lastDeliveredDate)) return gap('Migration receipt does not match the destination; no send')
    await commit(seed)
  }
  if (state.pending) return gap('Previous Telegram delivery is pending or uncertain; reconcile external evidence before any new publication or send')
  if (deliver && date <= state.lastDeliveredDate) return result('completed', `Already delivered for ${date}; no Telegram request`)
  if (state.pendingReport && (state.pendingReport.date !== date || state.pendingReport.seriesId !== seriesId)) return gap('An earlier publication needs reconciliation before another edition can be prepared')
  await mkdir(context.workspace, { recursive: true })
  let token
  try {
    token = await context.credentials.get('calendar_bot_token')
    const response = await context.http.request({ url: `https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`, method: 'GET', headers: {} })
    const body = JSON.parse(response.body)
    if (response.status !== 200 || body.ok !== true || String(body.result?.id) !== chatId) return gap('Telegram target/authentication not confirmed; no send')
  }
  catch { return gap('Telegram read-only target check failed; inspect assigned credential and permission') }
  let pending = state.pendingReport
  if (!pending && state.lastReport?.date === date && state.lastReport.seriesId === seriesId) pending = state.lastReport
  if (!pending) {
    const data = []
    for (const account of accounts) {
      const item = { account, errors: [] }
      for (const [field, argv] of [['today', ['calendar', 'today', '--account', account, '--json']], ['upcoming', ['calendar', 'list', '--account', account, '--days', '8', '--limit', '50', '--json']]]) {
        try { item[field] = readArray(await context.tools.invoke({ application: 'o365-cli', argv }), `${account}/${field}`) }
        catch { item.errors.push(`${account}/${field}: Kalender konnte nicht erfasst werden; Termine können fehlen`) }
      }
      data.push(item)
    }
    try { data.push({ repos: readIssues(await context.tools.invoke({ application: 'repos-issues', argv: ['list'] })) }) }
    catch { data.push({ reposError: 'Repository-Issues konnten nicht erfasst werden; offene Issues können fehlen' }) }
    if (data.some(item => item.reposError || item.errors?.length)) return gap('Required calendar or repository collection failed; no publication or send')
    const mailReview = Object.values(context.input.workflow?.outputs ?? {}).find(output => output.schema === 'morning-mail-review/v1')?.data
    let report
    try { report = buildBriefing(now, seriesId, data, mailReview, !deliver) }
    catch (error) { return gap(error.message) }
    if (parts(new Date()).dayKey !== date) return gap('Local date changed during collection; no publication or send')
    const body = JSON.stringify(report)
    pending = { key: `briefing:${seriesId}:${date}`, seriesId, date, body, digest: createHash('sha256').update(body).digest('hex') }
    await save(context.workspace, 'source-snapshot.json', JSON.stringify({ date, collectedAt: new Date().toISOString(), data, mailReview }))
    await save(context.workspace, 'report-preview.json', body)
    await commit({ ...state, pendingReport: pending })
  }
  let publication
  try { publication = await publish(context, pending, origin) }
  catch (error) {
    if (error.retryablePublicationResponse) await commit({ ...state, pendingReport: { ...pending, attempt: (pending.attempt ?? 0) + 1 } })
    return gap(`Report publication is not confirmed: ${error.message}. Frozen payload and idempotency key retained; no Telegram send.`)
  }
  await commit({ ...state, lastReport: { ...pending, publication }, pendingReport: null })
  const report = JSON.parse(pending.body)
  let text
  try { text = notification(date, publication, report) }
  catch (error) { return gap(error.message) }
  await save(context.workspace, 'preview.txt', `${text}\n`)
  await save(context.workspace, `publication-${seriesId}-${date}.json`, `${JSON.stringify(publication, null, 2)}\n`)
  if (!deliver) return result('completed', `Private live-source preview published: ${publication.edition_url}; Telegram target confirmed; no send`)
  const key = `calendar-briefing:${chatId}:${date}`
  await commit({ ...state, pending: { key, date, text, chatId, preparedAt: new Date().toISOString() } })
  let reply
  try {
    reply = await context.http.request({ url: `https://api.telegram.org/bot${token}/sendMessage`, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }), key, receipt: 'digest' })
  }
  catch { return gap('Telegram delivery result is uncertain; pending key retained, automatic resend prohibited') }
  let body
  try { body = JSON.parse(reply.body) }
  catch { return gap('Telegram receipt needs reconciliation; no resend') }
  if (reply.status !== 200 || body.ok !== true || String(body.result?.chat?.id) !== chatId || !Number.isSafeInteger(body.result?.message_id)) return gap('Telegram did not provide a matching delivery receipt; no resend')
  const delivery = { date, status: 'sent', key, messageId: body.result.message_id, telegramDate: body.result.date, chatId, source: 'pod-telegram-response', runId: context.input.runId, publication }
  await save(context.workspace, `delivery-${date}.json`, `${JSON.stringify(delivery, null, 2)}\n`)
  await commit({ ...state, lastDeliveredDate: date, delivery, pending: null })
  return result('completed', `Telegram delivery confirmed for ${date}; message ${delivery.messageId}; key ${key}; edition ${publication.id}`)
}
