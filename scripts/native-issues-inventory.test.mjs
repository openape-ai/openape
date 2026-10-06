import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'
import { collectPages, describeIssue, verifyCommentCounts } from './native-issues/inventory.mjs'

it('collects every page even when the server caps page size', async () => {
  const pages = [[{ id: 1 }], [{ id: 2 }], []]
  const requested = []
  const result = await collectPages(async (path) => {
    requested.push(path)
    return { items: pages.shift(), total: 2 }
  }, '/issues?state=all')
  assert.deepEqual(result.items.map(item => item.id), [1, 2])
  assert.equal(result.pages.length, 3)
  assert.match(requested[1], /page=2/)
})

it('rejects repeated records and inconsistent totals rather than claiming completeness', async () => {
  await assert.rejects(collectPages(async () => ({ items: [{ id: 1 }], total: 2 }), '/issues'), /Duplicate/)
  await assert.rejects(collectPages(async () => ({ items: [], total: 2 }), '/issues'), /count mismatch/)
})

it('propagates denied pages without returning a partial inventory', async () => {
  await assert.rejects(collectPages(async () => { throw new Error('HTTP 403') }, '/issues'), /403/)
})

it('metadata inventory excludes body, email and arbitrary user fields', () => {
  const metadata = describeIssue({ id: 4, number: 7, body: 'private body', user: { id: 9, login: 'reporter', email: 'private@example.test', token: 'secret' }, assets: [], labels: [] })
  const serialized = JSON.stringify(metadata)
  assert.doesNotMatch(serialized, /private body|private@example|secret/)
  assert.equal(metadata.bodySha256.length, 64)
  assert.deepEqual(metadata.author, { id: 9, login: 'reporter' })
})

it('checks issue comment counts independently from PR comments', () => {
  const issues = [{ number: 7, comments: 1 }, { number: 8, comments: 0 }]
  const comments = [{ id: 1, issue_url: 'https://forge.test/api/v1/repos/a/b/issues/7' }, { id: 2, issue_url: 'https://forge.test/api/v1/repos/a/b/issues/9', pull_request_url: 'https://forge.test/a/b/pulls/9' }]
  assert.deepEqual(verifyCommentCounts(issues, comments), [])
  assert.deepEqual(verifyCommentCounts(issues, []), [{ number: 7, expected: 1, observed: 0 }])
})

it('accepts Forgejo null terminal pages only when the advertised count reconciles', async () => {
  const pages = [[{ id: 1 }], null]
  const result = await collectPages(async () => ({ items: pages.shift(), total: 1 }), '/timeline')
  assert.equal(result.items.length, 1)
  await assert.rejects(collectPages(async () => ({ items: null, total: 1 }), '/timeline'), /Expected paginated array/)
})

it('reconciles a terminal null/zero-count timeline page against the earlier nonzero total', async () => {
  const pages = [{ items: [{ id: 1 }], total: 1 }, { items: null, total: 0 }]
  const result = await collectPages(async () => pages.shift(), '/timeline')
  assert.equal(result.items.length, 1)
  assert.equal(result.total, 1)
  const missing = [{ items: [{ id: 1 }], total: 2 }, { items: null, total: 0 }]
  await assert.rejects(collectPages(async () => missing.shift(), '/timeline'), /count mismatch/)
})

it('supports the Forgejo timeline header that counts only the current page', async () => {
  const pages = [{ items: [{ id: 1 }, { id: 2 }], total: 2 }, { items: [{ id: 3 }], total: 1 }, { items: null, total: 0 }]
  const result = await collectPages(async () => pages.shift(), '/timeline', { headerCountsPage: true })
  assert.deepEqual(result.items.map(item => item.id), [1, 2, 3])
  assert.equal(result.pages[1].total, 1)
})
