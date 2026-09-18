import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { checkState, createClient, execute, parseRepository } from './ape-git.mjs'

const sha = 'a'.repeat(40)
describe('native forge CLI', () => {
  it('rejects missing, partial and stale/untrusted check evidence', () => {
    assert.equal(checkState([], ['ci'], sha).state, 'pending')
    assert.equal(checkState([], [], sha).state, 'unconfigured')
    assert.equal(checkState([{ sha, context: 'ci', state: 'success', provider: 'webhook' }], ['ci'], sha).state, 'pending')
    assert.equal(checkState([{ sha: 'b'.repeat(40), context: 'ci', state: 'success', provider: 'forgejo' }], ['ci'], sha).state, 'pending')
    assert.equal(checkState([{ sha, context: 'ci', state: 'success', provider: 'forgejo' }], ['ci'], sha).state, 'success')
  })
  it('never merges without an explicitly reviewed pair or refetches heads implicitly', async () => {
    const calls = []
    const request = async (...args) => { calls.push(args); return { sha } }
    await assert.rejects(execute(['pr', 'merge', '7'], request), /full 40-character/)
    assert.equal(calls.length, 0)
    await execute(['pr', 'merge', '7', '--expected-source', sha, '--expected-target', 'b'.repeat(40)], request)
    assert.deepEqual(calls, [['POST', '/api/repos/patrick/monorepo/pulls/7/merge', { expectedSourceSha: sha, expectedTargetSha: 'b'.repeat(40) }]])
  })
  it('uses the existing bearer string once and returns structured stale-review errors', async () => {
    let auth
    const request = createClient({ authorize: async () => 'Bearer test', fetcher: async (_url, opts) => { auth = opts.headers.authorization; return { ok: false, status: 409, json: async () => ({ title: 'Review is stale' }) } } })
    await assert.rejects(request('POST', '/api/repos/o/r/pulls/1/merge'), e => e.code === 'STALE_REVIEW' && e.status === 409)
    assert.equal(auth, 'Bearer test')
  })
  it('distinguishes a missing grant from a pending merge gate', async () => {
    for (const [status, title, code] of [[403, 'Grant required', 'ACCESS_DENIED'], [409, 'Required checks block merge: pending', 'CHECKS_BLOCKED']]) {
      const request = createClient({ authorize: async () => 'Bearer test', fetcher: async () => ({ ok: false, status, json: async () => ({ title }) }) })
      await assert.rejects(request('GET', '/api/repos/o/r'), e => e.code === code && e.status === status)
    }
  })
  it('keeps token/cache errors out of authentication diagnostics', async () => {
    const request = createClient({ authorize: async () => { throw new Error('secret-credential') } })
    await assert.rejects(request('GET', '/api/repos'), e => e.code === 'AUTH_REQUIRED' && !e.message.includes('secret-credential'))
    assert.throws(() => parseRepository('../secrets'), /owner\/name/)
  })
})

describe('native issue CLI', () => {
  it('preserves exact Markdown and the supplied retry key without shell interpolation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'issue-cli-'))
    const path = join(directory, 'body.md')
    const content = 'Unicode: ü 🦍\n\n`$HOME` $(not-a-command)\n'
    writeFileSync(path, content)
    const calls = []
    try {
      await execute(['issue', 'create', '--repo', 'owner/repo', '--title', 'A problem', '--body-file', path, '--idempotency-key', 'repeat-key-001'], async (...args) => { calls.push(args); return { id: 'stable-id' } })
      assert.deepEqual(calls, [['POST', '/api/repos/owner/repo/issues', { title: 'A problem', body: content }, { idempotencyKey: 'repeat-key-001' }]])
      assert.equal(readFileSync(path, 'utf8'), content)
    }
    finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('rejects unknown options and missing edit revisions before making a request', async () => {
    const calls = []
    const request = async (...args) => { calls.push(args); return {} }
    await assert.rejects(execute(['issue', 'close', '1'], request), /expected-version/)
    await assert.rejects(execute(['issue', 'list', '--author', 'someone'], request), /Unknown/)
    await assert.rejects(execute(['issue', 'close', '1', '--expected-version', '1junk'], request), /positive integer/)
    await assert.rejects(execute(['issue', 'show', '1', '--id', 'another'], request), /one issue number/)
    assert.equal(calls.length, 0)
  })

  it('uses stable reporter IDs and sends access-filtered ecosystem queries to the server', async () => {
    const calls = []
    const request = async (...args) => { calls.push(args); return {} }
    await execute(['issue', 'show', '--id', 'report-id'], request)
    await execute(['issue', 'list', '--all-repos', '--product', 'plans', '--label', 'one,two'], request)
    await execute(['issue', 'close', '7', '--expected-version', '3'], request)
    assert.equal(calls[0][1], '/api/issue-records/report-id')
    assert.equal(calls[1][1], '/api/issues?product=plans&label=one&label=two')
    assert.deepEqual(calls[2].slice(0, 3), ['PATCH', '/api/repos/patrick/monorepo/issues/7', { expectedVersion: 3, state: 'closed' }])
  })

  it('sends retry headers and distinguishes issue conflicts from PR merge conflicts', async () => {
    let headers
    const request = createClient({ authorize: async () => 'Bearer fixture', fetcher: async (_url, opts) => { headers = opts.headers; return { ok: false, status: 409, json: async () => ({ statusMessage: 'Issue changed; reload before editing' }) } } })
    await assert.rejects(request('POST', '/api/issue-records/one/comments', { body: 'Hello' }, { idempotencyKey: 'retry-001' }), e => e.code === 'CONFLICT')
    assert.equal(headers['idempotency-key'], 'retry-001')
    assert.equal(headers.authorization, 'Bearer fixture')
  })
})
