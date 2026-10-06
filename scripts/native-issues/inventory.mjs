import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const hash = value => createHash('sha256').update(value ?? '').digest('hex')
const actor = user => user ? { id: user.id, login: user.login } : null
const fields = (value, names) => Object.fromEntries(names.filter(name => value[name] !== undefined).map(name => [name, value[name]]))

export async function collectPages(readPage, path, { headerCountsPage = false } = {}) {
  const items = []
  const pages = []
  const ids = new Set()
  let expectedTotal
  for (let page = 1; page <= 10000; page++) {
    const separator = path.includes('?') ? '&' : '?'
    const response = await readPage(`${path}${separator}limit=50&page=${page}`)
    const terminalZero = response.items === null && response.total === 0
    if (terminalZero || (response.items === null && response.total === items.length)) response.items = []
    if (!Array.isArray(response.items)) throw new Error(`Expected paginated array: ${path}`)
    if (headerCountsPage && response.total !== undefined && response.total !== response.items.length) throw new Error(`Page count mismatch: ${path}`)
    if (!headerCountsPage && response.total !== undefined && !(terminalZero && expectedTotal !== undefined)) {
      if (!Number.isSafeInteger(response.total) || response.total < 0) throw new Error(`Invalid total: ${path}`)
      if (expectedTotal !== undefined && expectedTotal !== response.total) throw new Error(`Source total changed: ${path}`)
      expectedTotal = response.total
    }
    pages.push({ page, count: response.items.length, total: response.total })
    for (const item of response.items) {
      if (!Number.isSafeInteger(item.id)) throw new Error(`Missing record ID: ${path}`)
      if (ids.has(item.id)) throw new Error(`Duplicate ID ${item.id}: ${path}`)
      ids.add(item.id)
      items.push(item)
    }
    if (response.items.length === 0) {
      if (expectedTotal !== undefined && items.length !== expectedTotal) throw new Error(`Source count mismatch: ${path}`)
      return { items, pages, total: expectedTotal }
    }
  }
  throw new Error(`Page limit exceeded: ${path}`)
}

function describeAsset(asset) {
  return fields(asset, ['id', 'name', 'size', 'uuid', 'created_at'])
}

export function describeIssue(issue) {
  return {
    ...fields(issue, ['id', 'number', 'state', 'created_at', 'updated_at', 'closed_at', 'comments', 'is_locked', 'pin_order', 'due_date', 'original_author', 'original_author_id']),
    bodySha256: hash(issue.body),
    titleSha256: hash(issue.title),
    author: actor(issue.user),
    assignees: (issue.assignees ?? []).map(actor),
    milestoneId: issue.milestone?.id ?? null,
    labels: (issue.labels ?? []).map(label => label.id),
    assets: (issue.assets ?? []).map(describeAsset),
    markdownReferences: [...new Set((issue.body ?? '').match(/#\d+/g) ?? [])],
    externalImageCount: ((issue.body ?? '').match(/!\[[^\]]*\]\(https?:/g) ?? []).length,
  }
}

export function verifyCommentCounts(issues, comments) {
  const counts = new Map()
  for (const comment of comments) {
    if (comment.pull_request_url) continue
    const number = Number(comment.issue_url?.split('/').at(-1))
    counts.set(number, (counts.get(number) ?? 0) + 1)
  }
  return issues.flatMap(issue => (counts.get(issue.number) ?? 0) === issue.comments
    ? []
    : [{ number: issue.number, expected: issue.comments, observed: counts.get(issue.number) ?? 0 }])
}

function createReader(endpoint, token) {
  return async (path) => {
    const response = await fetch(`${endpoint}/api/v1${path}`, {
      headers: { Authorization: `token ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`)
    const total = response.headers.get('x-total-count')
    return { items: await response.json(), total: total === null ? undefined : Number(total) }
  }
}

async function inventory(endpoint, repository, output, token) {
  const read = createReader(endpoint, token)
  const prefix = `/repos/${repository}`
  const startedAt = new Date().toISOString()
  const [version, repo, issues, comments, labels, collaborators, teams] = await Promise.all([
    read('/version'), read(prefix), collectPages(read, `${prefix}/issues?state=all&type=issues&sort=oldest`),
    collectPages(read, `${prefix}/issues/comments`), collectPages(read, `${prefix}/labels`),
    collectPages(read, `${prefix}/collaborators`), read(`${prefix}/teams`),
  ])
  const timeline = []
  for (let start = 0; start < issues.items.length; start += 4) {
    const batch = await Promise.all(issues.items.slice(start, start + 4).map(async (issue) => {
      const result = await collectPages(read, `${prefix}/issues/${issue.number}/timeline`, { headerCountsPage: true })
      return { number: issue.number, pages: result.pages, events: result.items.map(event => ({
        ...fields(event, ['id', 'type', 'created_at', 'updated_at', 'original_author', 'original_author_id']),
        actor: actor(event.user), bodySha256: hash(event.body),
      })) }
    }))
    timeline.push(...batch)
    process.stderr.write(`Inventoried timelines: ${timeline.length}/${issues.items.length}\n`)
  }
  const after = await collectPages(read, `${prefix}/issues?state=all&type=issues&sort=oldest`)
  const described = issues.items.map(describeIssue)
  const stable = JSON.stringify(described) === JSON.stringify(after.items.map(describeIssue))
  const commentMismatches = verifyCommentCounts(issues.items, comments.items)
  const issueNumbers = new Set(issues.items.map(issue => issue.number))
  const issueComments = comments.items.filter(comment => !comment.pull_request_url && issueNumbers.has(Number(comment.issue_url?.split('/').at(-1))))
  const summary = {
    repository, version: version.items.version, startedAt, finishedAt: new Date().toISOString(),
    private: repo.items.private, issues: issues.items.length,
    open: issues.items.filter(issue => issue.state === 'open').length,
    highWaterNumber: Math.max(0, ...issues.items.map(issue => issue.number)),
    comments: issueComments.length, labels: labels.items.length,
    timelineEvents: timeline.reduce((sum, item) => sum + item.events.length, 0),
    sourceStableDuringRead: stable, commentMismatches,
    issueAssets: described.reduce((sum, item) => sum + item.assets.length, 0),
    commentAssets: issueComments.reduce((sum, item) => sum + (item.assets ?? []).length, 0),
    locked: described.filter(issue => issue.is_locked).map(issue => issue.number),
    multipleAssignees: described.filter(issue => issue.assignees.length > 1).map(issue => issue.number),
    hasMilestone: described.filter(issue => issue.milestoneId !== null).map(issue => issue.number),
    hasExternalImages: described.filter(issue => issue.externalImageCount > 0).map(issue => issue.number),
  }
  await mkdir(output, { recursive: true, mode: 0o700 })
  const documents = {
    summary,
    repository: fields(repo.items, ['id', 'full_name', 'private', 'archived', 'has_issues', 'has_actions', 'has_pull_requests', 'default_branch', 'internal_tracker', 'permissions']),
    issues: { pages: issues.pages, afterPages: after.pages, records: described },
    comments: { pages: comments.pages, records: issueComments.map(comment => ({ ...fields(comment, ['id', 'issue_url', 'created_at', 'updated_at', 'original_author', 'original_author_id']), author: actor(comment.user), bodySha256: hash(comment.body), assets: (comment.assets ?? []).map(describeAsset) })) },
    labels,
    collaborators: { pages: collaborators.pages, records: collaborators.items.map(user => ({ ...actor(user), permissions: user.permissions })) },
    teams: { pagination: 'unpaginated', records: teams.items.map(team => fields(team, ['id', 'name', 'permission', 'units_map', 'includes_all_repositories'])) },
    timeline,
  }
  for (const [name, data] of Object.entries(documents)) {
    await writeFile(resolve(output, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if (!stable || commentMismatches.length) throw new Error('Inventory requires reconciliation; source changed or comment totals differ')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [endpoint, repository, output, ...extra] = process.argv.slice(2)
  if (!endpoint || !repository || !output || extra.length || !/^https:\/\/[^/]+$/.test(endpoint) || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !process.env.FORGEJO_TOKEN) {
    throw new Error('Usage: FORGEJO_TOKEN=<secret> node scripts/native-issues/inventory.mjs https://host owner/repo <new-private-output-directory>')
  }
  await inventory(endpoint, repository, output, process.env.FORGEJO_TOKEN)
}
