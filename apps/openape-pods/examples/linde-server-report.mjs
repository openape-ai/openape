import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const hosts = ['dev-portal.lindeverlag.at', 'portal-staging.lindeverlag.at', 'portal.lindeverlag.at', 'lb.lindeverlag.at', 'auth-prod.lindeverlag.at']
const origin = 'https://report.openape.ai'
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const value = observation => observation?.error || (observation?.exitCode !== undefined && observation.exitCode !== 0) ? null : observation?.value ?? null
const paragraph = text => `<p>${escape(text)}</p>`
const hash = text => createHash('sha256').update(text).digest('hex')

export function assess(host, observation, now) {
  if (observation.error) return { gap: true, attention: true, html: `<section><h2>${escape(host)}</h2>${paragraph(`Der Server konnte nicht geprüft werden: ${observation.error}. Sein Zustand ist unbekannt.`)}</section>` }
  const facts = observation.facts
  const text = []; let gap = false; let attention = false
  const unknown = (message) => { gap = true; text.push(message) }
  const kernel = value(facts.kernel)
  const os = value(facts.os)?.match(/^PRETTY_NAME="?([^"\n]+)"?$/m)?.[1]
  text.push(`Die SSH-Beobachtung stammt vom ${facts.observedAt}. ${os ? `Das Betriebssystem meldet ${os}.` : 'Die Betriebssystemversion ist unbekannt.'} ${kernel ? `Der laufende Kernel ist ${kernel}.` : 'Der laufende Kernel konnte nicht bestimmt werden.'}`)
  if (!os || !kernel) gap = true
  if (facts.rebootRequired) { attention = true; text.push('Das System fordert einen Neustart an. Ein Wartungsfenster sollte geprüft werden; dieser Lauf startet den Server nicht neu.') }
  else {
    text.push('Die systemseitige Neustartmarkierung ist nicht gesetzt. Das allein bestätigt keine vollständige Aktualität.')
  }
  const installedKernels = Array.from((facts.packages?.value ?? '').matchAll(/^installed linux-image-(\d[^ ]+) /gm), item => item[1]).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const latestKernel = installedKernels.at(-1)
  if (latestKernel) {
    text.push(`Der höchste nachgewiesene installierte Kernel ist ${latestKernel}.`)
    if (kernel && latestKernel.localeCompare(kernel, 'en', { numeric: true }) > 0) { attention = true; text.push('Dieser installierte Kernel ist neuer als der laufende Kernel. Ein Neustart wäre gesondert zu planen und freizugeben.') }
  }
  else {
    unknown('Die installierten Kernel konnten nicht verlässlich bestimmt werden.')
  }
  const policy = value(facts.candidates)
  if (policy === null) {
    unknown('Installierte Versionen und verfügbare Kandidaten konnten nicht vollständig aus dem lokalen Paketcache ermittelt werden.')
  }
  else {
    const packages = [...policy.matchAll(/^(\S+):\n\s+Installed: (.+)\n\s+Candidate: (.+)/gm)]
    for (const [, name, installed, candidate] of packages) {
      if (installed === '(none)') continue
      if (candidate !== '(none)' && candidate !== installed) { attention = true; text.push(`Für ${name} ist ${installed} installiert; der lokale Paketcache nennt ${candidate} als abweichenden Installationskandidaten. Vor einer Änderung sind Paketquellen und Kompatibilität zu prüfen.`) }
      else {
        text.push(`${name} ist mit ${installed} installiert; im lokalen Paketcache liegt kein abweichender Kandidat vor.`)
      }
    }
    if (!packages.length) unknown('Der Paketcache lieferte keine auswertbaren Versionspaare.')
  }
  const refresh = value(facts.packageRefresh)
  const refreshedAt = refresh?.match(/^ExecMainExitTimestamp=(.+)$/m)?.[1]
  const age = refreshedAt ? now.getTime() - Date.parse(refreshedAt) : Number.NaN
  if (refresh?.includes('Result=success') && refresh.includes('ExecMainStatus=0') && Number.isFinite(age) && age >= 0) {
    text.push(`apt-daily meldet einen erfolgreichen Abschluss am ${refreshedAt}. Die Paketlisten wurden für diese Prüfung nicht aktualisiert.`)
    if (age > 48 * 3600000) { attention = true; text.push('Dieser Nachweis ist älter als 48 Stunden; die Kandidatenbewertung beruht auf möglicherweise veralteten Paketlisten.') }
  }
  else {
    unknown('Für eine erfolgreiche Aktualisierung der Paketlisten fehlt ein belastbarer Zeitnachweis. Cache-Ergebnisse sind deshalb nur eingeschränkt aussagekräftig.')
  }
  const disk = value(facts.disk)?.match(/\s(\d+)%\s+\/$/m)
  if (disk) { text.push(`Das Root-Dateisystem ist zu ${disk[1]} Prozent belegt.`); if (Number(disk[1]) >= 85) { attention = true; text.push('Die Belegung überschreitet die Warnschwelle von 85 Prozent.') } }
  else {
    unknown('Die Belegung des Root-Dateisystems konnte nicht bestimmt werden.')
  }
  const services = value(facts.services)
  const expected = host === 'lb.lindeverlag.at' ? ['nginx.service'] : host === 'auth-prod.lindeverlag.at' ? ['nginx.service', 'pm2-linde.service'] : host === 'dev-portal.lindeverlag.at' ? [] : ['pm2-LPortalService.service']
  for (const name of expected) {
    const block = services?.split('\n\n').find(item => item.includes(`Id=${name}\n`))
    const active = block?.match(/^ActiveState=(.+)$/m)?.[1]
    if (!block || block.includes('LoadState=not-found') || !active) {
      unknown(`Für den erwarteten Dienst ${name} fehlt ein auswertbarer Status.`)
    }
    else { text.push(`Der Dienst ${name} meldet ${active}.`); if (active !== 'active') attention = true }
  }
  for (const certificate of facts.certificates) {
    const certificateValue = value(certificate.result)
    const end = certificateValue?.match(/^notAfter=(.+)$/m)?.[1]
    const fingerprint = certificateValue?.match(/Fingerprint=(.+)$/m)?.[1]
    const days = end ? Math.floor((Date.parse(end) - now.getTime()) / 86400000) : Number.NaN
    if (!Number.isFinite(days) || !fingerprint) {
      unknown(`Das gespeicherte Zertifikat ${certificate.name} konnte nicht bewertet werden.`)
    }
    else {
      text.push(`Das gespeicherte Zertifikat ${certificate.name} läuft am ${end} ab; verbleibend sind ${days} Tage. SHA-256-Fingerabdruck: ${fingerprint}.`)
      if (days <= 30) { attention = true; text.push(days < 0 ? 'Dieses Zertifikat ist abgelaufen und erfordert eine gesondert freigegebene Prüfung.' : 'Die Restlaufzeit liegt innerhalb der Warnschwelle von 30 Tagen; die Erneuerung sollte kontrolliert werden.') }
    }
  }
  if (['lb.lindeverlag.at', 'auth-prod.lindeverlag.at'].includes(host) && !facts.certificates.length) unknown('Für diesen TLS-Server wurden keine gespeicherten Zertifikate erfasst.')
  if (host === 'dev-portal.lindeverlag.at') {
    const backup = value(facts.backup)
    if (backup) {
      text.push(`Die dokumentierte S3-Sicherung meldet: ${backup.slice(0, 1000)}. Das ist ein Laufnachweis; ein Wiederherstellungstest wurde nicht ausgeführt.`)
      const backupTime = Date.parse(backup.split(/\s+/)[0])
      if (!Number.isFinite(backupTime) || !/\bok$/.test(backup)) { attention = true; unknown('Der Sicherungsnachweis enthält keinen eindeutig erfolgreichen, datierten Lauf.') }
      else if (now.getTime() - backupTime > 48 * 3600000 || backupTime > now.getTime()) { attention = true; text.push('Der Zeitstempel der Sicherung liegt außerhalb des erwarteten 48-Stunden-Fensters und muss geprüft werden.') }
    }
    else {
      unknown('Der dokumentierte Laufnachweis der S3-Sicherung konnte nicht gelesen werden. Die Wiederherstellbarkeit ist ungeprüft.')
    }
  }
  for (const health of facts.authHealth) {
    const status = value(health.result)?.match(/HTTP (\d{3})$/)?.[1]
    if (status === '200') {
      text.push(`Der lokale Auth-Health-Endpunkt auf Port ${health.port} antwortet mit HTTP 200.`)
    }
    else if (status === '404') {
      unknown(`Der lokale Auth-Health-Endpunkt auf Port ${health.port} liefert HTTP 404. Dieser Pfad erlaubt keine Aussage über die Funktionsfähigkeit der Anwendung; der Server wird deshalb nicht als ausgefallen bewertet.`)
    }
    else { unknown(`Der lokale Auth-Health-Endpunkt auf Port ${health.port} konnte nicht erfolgreich bestätigt werden (${status ?? 'keine HTTP-Antwort'}).`); attention = true }
  }
  return { gap, attention, html: `<section><h2>${escape(host)}</h2>${text.map(paragraph).join('')}</section>` }
}

export function document(observations, generatedAt, seriesId) {
  const results = hosts.map(host => assess(host, observations[host] ?? { error: 'Keine Beobachtung vorhanden' }, new Date(generatedAt)))
  const gaps = results.filter(item => item.gap).length; const attention = results.filter(item => item.attention).length
  const summary = `Für ${attention} der fünf Server gibt es Prüfhinsweise. Anzahl der Server mit Nachweislücken: ${gaps}.`
  const html = `<main><h1>Linde – technischer Serverprüfbericht</h1>${paragraph(`Erstellt am ${generatedAt}. ${summary}`)}${paragraph('Der Lauf liest Systemzustände und erstellt diesen Bericht. Wartungsarbeiten werden ausschließlich nach gesonderter Freigabe ausgeführt. Auch unveränderte Ergebnisse werden berichtet.')}<h2>Bewertungsgrenzen</h2>${paragraph('Die Versionsbewertung vergleicht installierte Pakete mit dem vorhandenen lokalen APT-Cache. Sie ersetzt weder eine Prüfung aller Sicherheitsmeldungen noch eine vollständige Schwachstellenanalyse. Zertifikatangaben betreffen Dateien auf dem Server; das tatsächlich extern ausgelieferte Zertifikat und die öffentliche Erreichbarkeit wurden nicht geprüft. Eine Quellcode-SHA der laufenden Anwendung ist ohne Deployment-Beleg unbekannt. SSH- und Systemzeit werden als Quellen vorausgesetzt. Fehlende Beobachtungen werden ausdrücklich benannt.')}${results.map(item => item.html).join('')}</main>`
  return { summary, gaps, envelope: { type: 'document', schemaVersion: 1, seriesId, title: `Linde – Serverprüfung ${generatedAt}`, language: 'de', category: 'Test Runs', html, css: 'body{font:16px/1.6 system-ui;color:#18252d;background:#f5f7f9;padding:32px}main{max-width:960px;margin:auto}section{background:white;padding:24px;margin:20px 0;border-radius:12px}h1,h2{line-height:1.25}p{overflow-wrap:anywhere}', assets: [] } }
}

export async function run(context) {
  let revision = context.input.checkpointRevision; let state = context.input.checkpoint ?? {}
  const commit = async (next) => { revision = (await context.progress.commit({ expectedRevision: revision, checkpoint: next, sources: [], claims: [] })).revision; state = next }
  const finish = async (summary, incomplete, delivered = false) => {
    const id = `linde-gap-${context.input.runId}`
    if (incomplete) await context.progress.commit({ expectedRevision: revision, checkpoint: state, sources: [{ id, locator: 'linde:server-report', version: context.input.runId, content: summary }], claims: [{ id, matter: 'Linde server report', kind: 'gap', text: summary, sourceIds: [id] }] })
    return { status: incomplete && !delivered ? 'completedWithGaps' : 'completed', summary, gapIds: incomplete ? [id] : [], completedInputIds: context.input.eventIds }
  }
  const mode = context.variables.delivery_mode; const seriesId = context.variables.reports_series_id; const chatId = context.variables.telegram_chat_id
  if (!['preview', 'live'].includes(mode) || !/^[A-Z0-9]{26}$/.test(seriesId ?? '') || !/^\d+$/.test(chatId ?? '')) return finish('Missing reviewed reporting configuration; no report or message sent.', true)
  let targets
  try { targets = JSON.parse(context.variables.inventory_targets) }
  catch { return finish('Missing assigned SSH targets; no report or message sent.', true) }
  if (hosts.some(host => !/^[a-f0-9-]{36}$/.test(targets[host] ?? '')) || Object.keys(targets).length !== hosts.length) return finish('Exactly five assigned Linde targets are required.', true)
  const key = `linde:${hash(JSON.stringify(context.input.eventIds.length ? [...context.input.eventIds].sort() : [context.input.runId]))}`
  if (state.last?.key === key) return finish(`Report already delivered: ${state.last.url}`, false)
  if (!state.pending) {
    const observations = {}
    let index = 0
    const collect = async () => {
      while (index < hosts.length) {
        const host = hosts[index++]
        try { observations[host] = await context.tools.invoke({ sshInventory: targets[host] }) }
        catch (error) { observations[host] = { error: error instanceof Error ? error.message : 'SSH inventory unavailable' } }
      }
    }
    await Promise.all([collect(), collect()])
    const report = document(observations, new Date().toISOString(), seriesId)
    const body = JSON.stringify(report.envelope)
    await writeFile(join(context.workspace, 'latest-report.json'), body, { mode: 0o600 })
    if (mode === 'preview') return finish(`Preview saved. ${report.summary}`, report.gaps > 0)
    await commit({ ...state, pending: { key, body, digest: hash(body), seriesId, chatId, summary: report.summary, gaps: report.gaps, publication: null } })
  }
  const pending = state.pending
  if (pending.seriesId !== seriesId || pending.chatId !== chatId || mode !== 'live') return finish('Pending delivery configuration changed; reconcile before continuing.', true)
  try {
    if (!pending.publication) {
      const receiptUrl = `${origin}/api/reports/publication?key=${encodeURIComponent(pending.key)}&seriesId=${seriesId}`
      let reply = await context.http.request({ url: receiptUrl, method: 'GET', headers: {} })
      if (reply.status === 404) reply = await context.http.request({ url: `${origin}/api/reports`, method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': pending.key }, body: pending.body, key: `${pending.key}:publish` })
      const receipt = JSON.parse(reply.body)
      if (![200, 201].includes(reply.status) || receipt.digest !== pending.digest || typeof receipt.url !== 'string' || !/^https:\/\/report\.openape\.ai\/r\/[\w-]+$/.test(receipt.url) || !Number.isInteger(receipt.version) || receipt.version < 1) throw new Error('Reports did not return a matching private publication receipt')
      await commit({ ...state, pending: { ...pending, publication: { id: receipt.id, url: receipt.url, version: receipt.version } } })
    }
    const publication = state.pending.publication
    const token = await context.credentials.get('telegram_bot_token')
    const text = `Linde · Serverprüfbericht\n${pending.summary}\n${publication.url}\nEs wurden keine Wartungsarbeiten ausgeführt.`
    const reply = await context.http.request({ url: `https://api.telegram.org/bot${token}/sendMessage`, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }), key: `${pending.key}:telegram` })
    const message = JSON.parse(reply.body)
    if (reply.status !== 200 || message.ok !== true || !Number.isInteger(message.result?.message_id) || String(message.result?.chat?.id) !== chatId) throw new Error('Telegram did not confirm delivery to the assigned personal chat')
    await commit({ ...state, pending: null, last: { key: pending.key, url: publication.url, messageId: message.result.message_id, deliveredAt: new Date().toISOString() } })
    return finish(`Report published and Telegram delivery confirmed: ${publication.url}. ${pending.summary}`, pending.gaps > 0, true)
  }
  catch (error) { return finish(`Report delivery incomplete: ${error instanceof Error ? error.message : 'unknown error'}. The pending publication and delivery keys are preserved.`, true) }
}
