import type { HtmlMetadata, HtmlPublication } from '@openape/report-contracts/html'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { inspectHtml, invalid, ReportError } from '@openape/report-contracts/html'
import { parseReportsArgs, reportsHelp } from './reports-options'
import { reportsClient } from './reports-client'
import { openReportUrl, previewReport } from './reports-preview'
import { version } from '../package.json'

type Values = Record<string, string | boolean | string[] | undefined>
function value(values: Values, name: string) { return typeof values[name] === 'string' ? values[name] as string : undefined }
function repeated(values: Values, name: string): string[] { const item = values[name]; return Array.isArray(item) ? item : [] }
function required(values: Values, name: string) { const result = value(values, name); if (!result) invalid(`--${name} is required`); return result }
function number(values: Values, name: string, mandatory = false) {
  const raw = mandatory ? required(values, name) : value(values, name)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid(`--${name} must be a positive integer`)
  return parsed
}
function entries(items: string[]) {
  return Object.fromEntries(items.map((item) => { const split = item.indexOf('='); if (split < 1) invalid('Use namespaced key=value metadata'); return [item.slice(0, split), item.slice(split + 1)] }))
}
function audienceOptions(values: Values, mandatory = false) {
  const modes = ['private', 'public', 'reader', 'team'].filter(key => values[key] !== undefined)
  if (modes.length > 1 || (mandatory && modes.length !== 1)) invalid('Select exactly one audience: private, public, reader or team')
  if (!modes.length) return undefined
  return { mode: modes[0] === 'reader' ? 'readers' : modes[0], ...(modes[0] === 'reader' ? { readers: repeated(values, 'reader') } : {}), ...(modes[0] === 'team' ? { teamId: value(values, 'team') } : {}) }
}
function lifetimeOptions(values: Values, mandatory = false) {
  const modes = ['permanent', 'expires-in', 'expires-at'].filter(key => values[key] !== undefined)
  if (modes.length > 1 || (mandatory && modes.length !== 1)) invalid('Select exactly one explicit lifetime')
  if (!modes.length) return undefined
  return modes[0] === 'permanent' ? { permanent: true } : modes[0] === 'expires-in' ? { expiresIn: value(values, 'expires-in') } : { expiresAt: value(values, 'expires-at') }
}
function metadataChanges(values: Values, previous: Partial<HtmlMetadata> = {}) {
  const changes: Record<string, unknown> = {}
  for (const key of ['title', 'language', 'category']) {
    if (values[key] !== undefined && values[`clear-${key}`]) invalid(`--${key} conflicts with --clear-${key}`)
    if (values[key] !== undefined) changes[key] = values[key]
    if (values[`clear-${key}`]) changes[key] = null
  }
  if (values.tag && values['clear-tags']) invalid('--tag conflicts with --clear-tags')
  if (values.tag) changes.tags = repeated(values, 'tag')
  if (values['clear-tags']) changes.tags = []
  const set = entries(repeated(values, 'meta')); const unset = repeated(values, 'unset-meta')
  if (unset.some(key => key in set)) invalid('A metadata key cannot be set and unset together')
  if (values.meta || values['unset-meta']) {
    const fields = { ...previous.metadata, ...set }
    for (const key of unset) delete fields[key]
    changes.metadata = fields
  }
  return changes
}
function inputHtml(path: string) {
  try {
    if (!/\.html?$/iu.test(path) || !statSync(path).isFile()) invalid('Input must be exactly one .html file')
    return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path))
  }
  catch (error) { if (error instanceof ReportError) throw error; invalid(`Cannot read UTF-8 HTML: ${error instanceof Error ? error.message : path}`) }
}
function queryString(values: Values, keys: string[]) {
  const query = new URLSearchParams()
  for (const key of keys) {
    if (values[key] !== undefined) query.set(key === 'series-id' ? 'series' : key, String(values[key]))
  }
  if (values.tag) query.set('tags', JSON.stringify(repeated(values, 'tag')))
  if (values.meta) query.set('metadata', JSON.stringify(entries(repeated(values, 'meta'))))
  return query.size ? `?${query}` : ''
}
export async function runReports(argv: string[]) {
  const parsed = parseReportsArgs(argv); const values = parsed.values as Values; const command = parsed.command
  if (values.help) { process.stdout.write(`${reportsHelp(command || undefined)}\n`); return }
  if (values.version) { process.stdout.write(`${version}\n`); return }
  const positional = parsed.positionals
  const policy = ['access', 'retention'].includes(command)
  const expected = policy ? 2 : ['preview', 'publish', 'update', 'show', 'history', 'open', 'export', 'rm', 'restore'].includes(command) ? 1 : 0
  if (command !== 'docs' && positional.length !== expected) invalid(`Expected: ${reportsHelp(command).split('\n').find(line => line.startsWith('USAGE'))}`)
  if (command === 'docs') {
    const topic = positional[0]
    const topics: Record<string, string> = { 'getting-started': 'Write one HTML file. Run preview, publish with a stable key, then show or open the receipt URL. Default private/permanent.', html: 'Embed CSS, JavaScript, data, raster images, SVG, canvas and fonts. Maximum HTML: 20 MiB, each embedded resource: 8 MiB. External HTTPS images load only in the reader browser; Reports never fetches them. Active code is publisher-trusted and may transmit document data despite browser defenses.', metadata: 'title and html lang supply defaults. Optional script#openape-report type=application/json contains category, tags and metadata. Flags override embedded values; repeated --meta replaces individual keys. Metadata cannot configure identity, audience or lifetime.', versions: 'Updates require document ID and expected version. Stable links follow latest; exact URLs/digests remain unchanged. Retain keys and exact bytes after uncertainty; conflicts require explicit reconciliation.', auth: 'apes login <email> once. Existing audience testrun.openape.ai is preserved. Series-bound publishers cannot administer access or lifetime.', sharing: 'Private owner-only by default; choose multiple verified-email readers, one existing team or public. Public includes history. Revocation applies to every version; downloaded copies cannot be recalled. No notification is sent.', retention: 'Permanent by default. Explicit m/h/d durations use server time. Expiry denies reads without cleanup. Recover within 30 days with a new explicit lifetime, initially owner-only. Online content is then purged; backup retention is separate.', templates: 'Optional local templates belong with repositories, skills or Pods. Publish only the resulting HTML. No template registry, manifest or asset upload is required.', 'test-runs': 'Publish actual commands, tested SHA, pass/fail/skip outcomes and personally inspected screenshots under Test Runs. Embed material evidence images. ape-testruns upload remains compatible.', plans: 'Use category Plans and optional plans.status metadata. Status is not approval. Record explicit owner decisions and exact approved versions. Legacy Plans source editing uses its compatibility renderer and version checks.', errors: 'Exit 0 success; 1 unexpected; 2 usage/validation; 3 authentication; 4 permission; 5 not found/gone; 6 conflict; 7 transport/service. JSON errors go to stderr. Never resolve uncertain writes with a new key.' }
    if (positional.length > 1 || (topic && !topics[topic])) invalid('Unknown documentation topic')
    process.stdout.write(`${values.json ? JSON.stringify(topic ? { topic, text: topics[topic] } : { topics: Object.keys(topics) }) : topic ? topics[topic] : Object.keys(topics).join('\n')}\n`); return
  }
  let prepared: HtmlPublication | undefined
  if (command === 'preview' || command === 'publish') {
    const html = inputHtml(positional[0]!)
    const initial = inspectHtml(html, { ...(value(values, 'title') ? { title: value(values, 'title') } : {}) })
    const publication = inspectHtml(html, metadataChanges(values, initial) as Partial<HtmlMetadata>)
    prepared = publication
    if (command === 'preview') {
      if (values.check || values.json) { process.stdout.write(`${JSON.stringify({ valid: true, title: publication.title, category: publication.category, tags: publication.tags, language: publication.language, metadata: publication.metadata, bytes: Buffer.byteLength(html), external_images: publication.externalImages, trust: 'publisher-controlled active code; no absolute network barrier' }, null, 2)}\n`); return }
      await previewReport(publication, number(values, 'port') ?? 0); return
    }
  }
  const endpoint = value(values, 'endpoint') ?? process.env.APE_REPORTS_ENDPOINT ?? 'https://report.openape.ai'
  const request = reportsClient(endpoint)
  const id = encodeURIComponent(positional[policy ? 1 : 0] ?? '')
  const path = `/api/documents/${id}`
  let result: unknown
  if (command === 'whoami') {
    result = { ...await request('GET', '/api/cli/me'), endpoint }
  }
  else if (command === 'publish') {
    const { html, title, language, category, tags, metadata } = prepared!
    const documentId = value(values, 'document'); const expectedVersion = number(values, 'expected-version', Boolean(documentId))
    const audience = audienceOptions(values); const lifetime = lifetimeOptions(values)
    if (documentId && (audience || lifetime || values['series-id'])) invalid('Audience, lifetime and series options are creation-only')
    if (!documentId && expectedVersion !== undefined) invalid('--expected-version requires --document')
    result = await request('POST', '/api/documents', { schemaVersion: 2, html, metadata: { title, language, category, tags, metadata }, documentId, expectedVersion, audience, lifetime, seriesId: value(values, 'series-id') }, required(values, 'key'))
  }
  else if (command === 'update') {
    const expectedVersion = number(values, 'expected-version', true); const key = required(values, 'key')
    const previous = await request('GET', path)
    const changes = metadataChanges(values, previous)
    if (!Object.keys(changes).length) invalid('At least one metadata change is required')
    result = await request('PATCH', path, { expectedVersion, changes }, key)
  }
  else if (command === 'rm') {
    result = await request('DELETE', path, { expectedVersion: number(values, 'expected-version', true) })
  }
  else if (command === 'restore') {
    result = await request('POST', `${path}/restore`, { lifetime: lifetimeOptions(values, true) })
  }
  else if (policy) {
    if (!['show', 'set'].includes(positional[0]!)) invalid('Use show or set')
    if (positional[0] === 'show') {
      if (audienceOptions(values) || lifetimeOptions(values) || values['expected-access-revision'] || values['expected-retention-revision']) invalid('Policy changes require set')
      result = await request('GET', `${path}/${command}`)
    }
    else {
      result = await request('POST', `${path}/${command}`, command === 'access' ? { audience: audienceOptions(values, true), expectedAccessRevision: number(values, 'expected-access-revision', true) } : { lifetime: lifetimeOptions(values, true), expectedRetentionRevision: number(values, 'expected-retention-revision', true) })
    }
  }
  else if (command === 'export') {
    const output = resolve(required(values, 'output'))
    const body = await request('GET', `${path}/html${queryString(values, ['revision'])}`, undefined, undefined, true)
    try { writeFileSync(output, body, { flag: values.overwrite ? 'w' : 'wx' }) }
    catch (error) { invalid(`Cannot write export; use --overwrite explicitly to replace a file. ${error instanceof Error ? error.message : ''}`) }
    result = { output, bytes: Buffer.byteLength(body) }
  }
  else if (command === 'open') {
    const report = await request('GET', `${path}${queryString(values, ['revision'])}`)
    result = { url: values.revision ? report.version_url : report.url }
    if (!values.json) await openReportUrl((result as { url: string }).url)
  }
  else if (command === 'receipt') {
    result = await request('GET', `/api/documents/receipt?key=${encodeURIComponent(required(values, 'key'))}`)
  }
  else if (command === 'list') {
    result = await request('GET', `/api/documents${queryString(values, ['search', 'category', 'team', 'series-id', 'deleted', 'limit', 'cursor'])}`)
  }
  else if (['categories', 'tags', 'teams'].includes(command)) {
    result = await request('GET', `/api/documents/${command}${queryString(values, ['search', 'category', 'team', 'limit', 'cursor'])}`)
  }
  else if (command === 'history') {
    result = await request('GET', `${path}/history${queryString(values, ['limit', 'cursor'])}`)
  }
  else {
    result = await request('GET', `${path}${queryString(values, ['revision'])}`)
  }
  process.stdout.write(`${JSON.stringify(result, null, values.json ? undefined : 2)}\n`)
}

async function main() {
  try { await runReports(process.argv.slice(2)) }
  catch (error) {
    const failure = error instanceof ReportError ? error : new ReportError('UNEXPECTED', error instanceof Error ? error.message : String(error), 500)
    const code = failure.code === 'UNEXPECTED' ? 1 : failure.status === 401 ? 3 : failure.status === 403 ? 4 : [404, 410].includes(failure.status) ? 5 : failure.status === 409 ? 6 : failure.status >= 500 ? 7 : 2
    process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify({ error: { code: failure.code, message: failure.message } }) : `${failure.code}: ${failure.message}`}\n`)
    process.exitCode = code
  }

}
void main()
