import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { digest } from './export.mjs'

const require = createRequire(new URL('../../apps/openape-git/package.json', import.meta.url))
const { marked } = require('marked')

export const entityId = (kind, key) => `import-${kind}-${digest(key).slice(0, 32)}`
function stamp(value) { const result = Date.parse(value); if (!Number.isSafeInteger(result)) throw new Error(`Invalid source timestamp: ${value}`); return result }
function positive(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Expected a positive source number'); return value }
function unique(rows, key, name) { if (new Set(rows.map(row => row[key])).size !== rows.length) throw new Error(`Duplicate ${name}`) }

export function references(body, source, repository, knownIssues, knownPulls) {
  const found = new Map()
  function add(value) {
    let key = value
    if (/^#\d+$/.test(value)) key = `${source}/${repository}/${knownPulls.has(Number(value.slice(1))) ? 'pulls' : 'issues'}/${value.slice(1)}`
    else if (/^[\w.-]+\/[\w.-]+#\d+$/.test(value)) key = `${source}/${value.replace('#', '/issues/')}`
    const local = new URL(key, source)
    if (local.origin !== source) { found.set(value, { text: value, key, kind: 'external' }); return }
    const number = Number(local.pathname.split('/').at(-1))
    const known = local.pathname.startsWith(`/${repository}/`) && (local.pathname.includes('/pulls/') ? knownPulls.has(number) : knownIssues.has(number))
    found.set(value, { text: value, key, kind: known ? local.pathname.includes('/pulls/') ? 'pull' : 'issue' : 'unresolved' })
  }
  marked.walkTokens(marked.lexer(body), (token) => {
    if (['link', 'image'].includes(token.type)) add(token.href)
    if (token.type === 'text') {
      for (const match of token.text.matchAll(/(?<![\w/])(?:[\w.-]+\/[\w.-]+)?#([1-9]\d*)\b/g)) add(match[0])
    }
  })
  return [...found.values()]
}

export function makeManifest(snapshot, mapping, history) {
  if (snapshot.format !== 1 || !snapshot.snapshot.repository.private) throw new Error('Only reviewed private Forgejo snapshots are supported')
  const { source, repository } = snapshot
  const origin = new URL(source)
  if (origin.origin !== source || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === '127.0.0.1')) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid source identity')
  if (mapping.snapshotHash !== digest(snapshot)) throw new Error('Mapping refers to another snapshot')
  if (!mapping.destination?.id || !mapping.destination.owner || !mapping.destination.name || !mapping.operator) throw new Error('Destination identity and operator are required')
  if (!history || history.source !== source || history.repository !== repository || !Array.isArray(history.rows)) throw new Error('Matching restricted edit-history archive is required')
  const issues = []; const comments = []; const labels = []; const events = []; const assets = []; const origins = []; const aliases = []; const exceptions = []
  const key = (kind, id) => `${source}/${repository}/${kind}/${id}`
  const numbers = new Set(snapshot.snapshot.issues.map(issue => issue.number))
  const pulls = new Set(snapshot.snapshot.pulls.map(pull => pull.number))
  function exception(code, entity, detail, blocking = false) {
    const id = `${code}:${entity}`
    exceptions.push({ id, code, entity, detail, blocking, disposition: mapping.exceptions?.[id] ?? null })
  }
  function provenance(kind, sourceKey, id, row, raw) { origins.push({ sourceKey, kind, entityId: id, contentHash: digest(row), provenance: JSON.stringify(raw) }) }
  function identity(user) {
    const mapped = mapping.identities?.[String(user?.id)]
    if (mapped && (!mapped.subject || !mapped.verifiedBy || !mapped.proof)) throw new Error('Identity mapping requires independently reviewed subject, reviewer and evidence')
    return mapped?.subject ?? null
  }
  for (const label of snapshot.snapshot.labels) {
    const sourceKey = key('labels', label.id); const id = entityId('label', sourceKey)
    const color = `#${label.color.replace(/^#/, '')}`
    if (!/^#[a-f\d]{6}$/i.test(color)) throw new Error(`Invalid source label color: ${label.id}`)
    const row = { id, repo_id: mapping.destination.id, name: label.name, color, description: label.description || '', archived: label.is_archived ? 1 : 0, version: 1 }
    if (label.exclusive || label.is_exclusive) exception('exclusive-label', label.id, 'Exclusive behavior is archived, not enforced')
    labels.push(row); provenance('label', sourceKey, id, row, label)
  }
  for (const issue of snapshot.snapshot.issues) {
    positive(issue.number); const sourceKey = key('issues', issue.number); const id = entityId('issue', sourceKey)
    if (issue.pull_request) throw new Error('Pull requests must not enter the issue importer')
    if (issue.is_locked || issue.confidential) exception('restricted-issue', issue.number, 'Locked or confidential source needs an equivalent target restriction', true)
    if (issue.milestone) exception('milestone', issue.number, 'Milestone retained in the restricted archive')
    if (issue.due_date || issue.pin_order) exception('workflow-metadata', issue.number, 'Due date or pin retained in the restricted archive')
    if (!['open', 'closed'].includes(issue.state)) throw new Error(`Unsupported issue state: ${issue.state}`)
    const requested = mapping.assignees?.[String(issue.number)]
    const assignees = issue.assignees ?? []
    const mappedAssignees = assignees.map(identity).filter(Boolean)
    const assignee = requested !== undefined ? requested : assignees.length === 1 && mappedAssignees.length === 1 ? mappedAssignees[0] : null
    if (assignee && !mappedAssignees.includes(assignee)) throw new Error('Selected assignee is not a verified source assignee')
    if (assignees.length > 1 || (assignees.length && !assignee)) exception('assignment', issue.number, 'All source assignees retained; target assignment needs an approved primary or explicit unassigned disposition')
    const row = { id, repo_id: mapping.destination.id, number: positive(mapping.numbers?.[String(issue.number)] ?? issue.number), title: issue.title, body: issue.body ?? '', state: issue.state, product_key: null, assignee, author_subject: identity(issue.user), author_actor: null, version: 1, hidden: 0, created_at: stamp(issue.created_at), updated_at: stamp(issue.updated_at), closed_at: issue.closed_at ? stamp(issue.closed_at) : null, triage_state: 'classified' }
    if (!row.title || row.title.length > 200 || Buffer.byteLength(row.body) > 65536) exception('text-limit', issue.number, 'Original text exceeds current editor limits; preserve it and review before editing')
    const refs = references(row.body, source, repository, numbers, pulls)
    const raw = { ...issue, comments: undefined, timeline: undefined, commentAssets: undefined, source, sourceKey, references: refs }
    issues.push(row); provenance('issue', sourceKey, id, row, raw)
    aliases.push({ source_key: sourceKey, kind: 'issue', issue_id: id, comment_id: null })
    for (const ref of refs) {
      if (ref.kind === 'unresolved') exception('unresolved-reference', `${issue.number}:${ref.text}`, 'Original link/text retained; no guessed target')
    }
    for (const label of issue.labels ?? []) {
      if (!labels.some(item => item.id === entityId('label', key('labels', label.id)))) throw new Error(`Missing label: ${label.id}`)
    }
    for (const comment of issue.comments) {
      const commentKey = `${sourceKey}#issuecomment-${comment.id}`
      const commentId = `import-comment-${digest(source).slice(0, 8)}-${String(positive(comment.id)).padStart(16, '0')}`
      const value = { id: commentId, issue_id: id, body: comment.body ?? '', author_subject: identity(comment.user), author_actor: null, version: 1, hidden: 0, created_at: stamp(comment.created_at), updated_at: stamp(comment.updated_at ?? comment.created_at) }
      comments.push(value); provenance('comment', commentKey, commentId, value, { ...comment, source, sourceKey: commentKey, references: references(value.body, source, repository, numbers, pulls) })
      aliases.push({ source_key: commentKey, kind: 'comment', issue_id: id, comment_id: commentId })
    }
    for (const event of issue.timeline.filter(event => event.type !== 'comment')) {
      const eventKey = key('events', event.id)
      events.push({ id: entityId('event', eventKey), issue_id: id, action: `imported:${event.type}`, subject: `Forgejo: ${event.user?.login ?? 'Ghost'}`, actor: 'Forgejo import', details: JSON.stringify(event), created_at: stamp(event.created_at) })
    }
  }
  for (const asset of snapshot.assets) {
    const sourceIssue = snapshot.snapshot.issues.find(issue => issue.id === asset.issueId)
    if (!sourceIssue) throw new Error(`Asset without issue: ${asset.id}`)
    const issueId = entityId('issue', key('issues', sourceIssue.number))
    const commentId = asset.commentId ? comments.find(comment => JSON.parse(origins.find(origin => origin.entityId === comment.id).provenance).id === asset.commentId)?.id : null
    if (asset.commentId && !commentId) throw new Error(`Asset without comment: ${asset.id}`)
    if (!/^[a-f\d]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 0) throw new Error('Invalid asset hash or size')
    const row = { id: entityId('asset', key('assets', asset.id)), issue_id: issueId, comment_id: commentId ?? null, source_id: String(asset.id), filename: asset.name, mime_type: asset.mimeType, size: asset.size, sha256: asset.sha256, storage_key: asset.sha256, provenance: JSON.stringify(asset) }
    assets.push(row)
    aliases.push({ source_key: asset.browser_download_url, kind: 'asset', issue_id: issueId, comment_id: null })
  }
  for (const origin of origins.filter(origin => ['issue', 'comment'].includes(origin.kind))) {
    for (const ref of JSON.parse(origin.provenance).references) {
      if (ref.key.includes(`${source}/attachments/`) && !assets.some(asset => JSON.parse(asset.provenance).browser_download_url === ref.key)) exception('missing-inline-asset', origin.sourceKey, `Attachment metadata/bytes missing: ${ref.key}`, true)
      if (ref.kind === 'external') exception('external-link', `${origin.sourceKey}:${digest(ref.key).slice(0, 12)}`, 'External content remains a link; no privileged download')
    }
  }
  unique(issues, 'number', 'destination issue number'); unique(issues, 'id', 'issue'); unique(comments, 'id', 'comment'); unique(labels, 'name', 'label name'); unique(assets, 'id', 'asset')
  const labelLinks = snapshot.snapshot.issues.flatMap(issue => (issue.labels ?? []).map(label => ({ issue_id: entityId('issue', key('issues', issue.number)), label_id: entityId('label', key('labels', label.id)) })))
  const highWater = Math.max(0, ...snapshot.snapshot.issues.map(issue => issue.number), ...snapshot.snapshot.pulls.map(pull => pull.number), ...issues.map(issue => issue.number))
  return { format: 1, source, repository, destination: mapping.destination, operator: mapping.operator, snapshotHash: digest(snapshot), historyHash: digest(history), mappingHash: digest(mapping), batchId: entityId('batch', `${source}/${repository}:${mapping.destination.id}`), highWater, issues, comments, labels, labelLinks, events, assets, origins, aliases, exceptions }
}

export function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
