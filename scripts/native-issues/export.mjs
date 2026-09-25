import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { collectPages } from './inventory.mjs'

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
const durableAsset = ({ download_count: _count, ...asset }) => asset

export async function exportSource({ source, repository, output, token }) {
  const origin = new URL(source)
  if (origin.origin !== source || origin.username || origin.password || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === '127.0.0.1'))) throw new Error('Source must be an HTTPS origin or explicit loopback fixture')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) throw new Error('Repository and FORGEJO_TOKEN are required')
  await mkdir(output, { mode: 0o700 })
  await mkdir(join(output, 'assets'), { mode: 0o700 })
  async function read(path) {
    const response = await fetch(`${source}/api/v1${path}`, { headers: { Authorization: `token ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}: ${path}`)
    const total = response.headers.get('x-total-count')
    return { items: await response.json(), total: total === null ? undefined : Number(total) }
  }
  const prefix = `/repos/${repository}`
  async function snapshot() {
    const [version, repo, issues, labels, pulls, allComments] = await Promise.all([
      read('/version'), read(prefix), collectPages(read, `${prefix}/issues?state=all&type=issues&sort=oldest`), collectPages(read, `${prefix}/labels`), collectPages(read, `${prefix}/issues?state=all&type=pulls&sort=oldest`), collectPages(read, `${prefix}/issues/comments`),
    ])
    const records = []
    for (let offset = 0; offset < issues.items.length; offset += 4) {
      records.push(...await Promise.all(issues.items.slice(offset, offset + 4).map(async (issue) => {
        const comments = { items: allComments.items.filter(comment => !comment.pull_request_url && Number(comment.issue_url?.split('/').at(-1)) === issue.number) }
        const [timeline, assets] = await Promise.all([collectPages(read, `${prefix}/issues/${issue.number}/timeline`, { headerCountsPage: true }), read(`${prefix}/issues/${issue.number}/assets`)])
        if (comments.items.length !== issue.comments) throw new Error(`Comment count changed on issue ${issue.number}`)
        const commentAssets = []
        for (const comment of comments.items) {
          const result = await read(`${prefix}/issues/comments/${comment.id}/assets`)
          commentAssets.push(...result.items.map(asset => ({ ...durableAsset(asset), commentId: comment.id })))
        }
        return { ...issue, assets: assets.items.map(durableAsset), comments: comments.items, timeline: timeline.items, commentAssets }
      })))
    }
    return { version: version.items.version, repository: { id: repo.items.id, fullName: repo.items.full_name, private: repo.items.private }, labels: labels.items, issues: records, pulls: pulls.items.map(({ id, number, html_url }) => ({ id, number, html_url })) }
  }
  const startedAt = new Date().toISOString()
  const first = await snapshot()
  const assets = []
  for (const issue of first.issues) {
    for (const asset of [...issue.assets, ...issue.commentAssets]) {
      const url = new URL(asset.browser_download_url)
      if (url.origin !== source || !/^\/attachments\/[a-f\d-]{36}$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error(`Unapproved asset URL on issue ${issue.number}`)
      if (!Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > 25 * 1024 * 1024) throw new Error(`Unsupported asset size: ${asset.id}`)
      const response = await fetch(url, { headers: { Authorization: `token ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60000) })
      if (!response.ok) throw new Error(`Asset ${asset.id} returned HTTP ${response.status}`)
      const chunks = []; let size = 0
      for await (const chunk of response.body) { size += chunk.length; if (size > asset.size) throw new Error(`Asset size exceeded: ${asset.id}`); chunks.push(chunk) }
      const bytes = Buffer.concat(chunks)
      if (bytes.length !== asset.size) throw new Error(`Asset size mismatch: ${asset.id}`)
      const sha256 = digest(bytes)
      await writeFile(join(output, 'assets', sha256), bytes, { mode: 0o600 })
      assets.push({ ...asset, issueId: issue.id, sha256, mimeType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' })
    }
  }
  const second = await snapshot()
  if (digest(first) !== digest(second)) throw new Error('Source changed during export; discard this snapshot and retry')
  const result = { format: 1, source, repository, startedAt, finishedAt: new Date().toISOString(), snapshot: first, assets }
  await writeFile(join(output, 'snapshot.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  return { ok: true, issues: first.issues.length, comments: first.issues.reduce((total, issue) => total + issue.comments.length, 0), assets: assets.length, snapshotHash: digest(result) }
}
