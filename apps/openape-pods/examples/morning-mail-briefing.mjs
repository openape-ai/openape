import { writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const timezone = 'Europe/Vienna'

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

async function save(workspace, name, value) {
  const path = join(workspace, name)
  await writeFile(`${path}.tmp`, value, { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

export function readEditorial(context, now, seriesId, preview) {
  const workflow = context.input.workflow
  const output = workflow?.outputs?.[context.variables.editorial_pod_id]
  const data = output?.data
  const report = data?.report
  const age = now.getTime() - Date.parse(report?.generatedAt)
  if (output?.schema !== 'morning-editorial/v1' || data.runId !== workflow.runId || data.date !== parts(now).dayKey ||
      !Number.isFinite(age) || age < -60000 || age > 2 * 60 * 60 * 1000 || data.preview !== preview ||
      createHash('sha256').update(JSON.stringify(report)).digest('hex') !== data.digest) {
    throw new Error('Missing, stale or mismatched editorial handoff; no publication or send')
  }
  const keys = ['schemaVersion', 'type', 'editionDate', 'timezone', 'generatedAt', 'title', 'overview', 'importantItems', 'nextActions', 'calendar', 'emails', 'issues', 'sources', 'gaps']
  if (Object.keys(report).some(key => !keys.includes(key)) || report.schemaVersion !== 1 || report.type !== 'briefing' || report.timezone !== timezone || report.editionDate !== data.date ||
      typeof report.overview !== 'string' || !report.overview.trim() || typeof report.title !== 'string' ||
      ['importantItems', 'nextActions', 'calendar', 'emails', 'issues', 'sources', 'gaps'].some(key => !Array.isArray(report[key])) ||
      report.importantItems.length || report.nextActions.length || report.emails.some(mail => !['keep', 'action'].includes(mail.disposition) || (mail.disposition === 'keep' && mail.nextAction))) {
    throw new Error('Invalid editorial report contract')
  }
  const bound = { ...report, seriesId, title: preview ? 'Morgenbericht · Vorschau' : 'Dein Morgenbericht' }
  if (Buffer.byteLength(JSON.stringify(bound)) > 60 * 1024) throw new Error('Briefing exceeds the 60 KiB publication limit')
  return bound
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
    let report
    try { report = readEditorial(context, now, seriesId, !deliver) }
    catch (error) { return gap(error.message) }
    const body = JSON.stringify(report)
    pending = { key: `briefing:${seriesId}:${date}`, seriesId, date, body, digest: createHash('sha256').update(body).digest('hex') }
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
