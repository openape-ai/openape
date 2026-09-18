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

describe('native product reporting CLI', () => {
  it('requires exact routing and version values before network access', async () => {
    const calls = []
    const request = async (...args) => { calls.push(args); return {} }
    await execute(['issue', 'product', 'list', '--product', 'plans'], request)
    await execute(['issue', 'product', 'set', '--product', 'plans', '--name', 'Plans', '--enabled', 'true', '--expected-version', '0'], request)
    await execute(['issue', 'policy', 'set', '--enabled', 'false', '--expected-version', '2'], request)
    assert.equal(calls[0][1], '/api/products?product=plans')
    assert.deepEqual(calls[1][2], { name: 'Plans', enabled: true, expectedVersion: 0 })
    assert.deepEqual(calls[2][2], { reportingEnabled: false, expectedVersion: 2 })
    await assert.rejects(execute(['issue', 'policy', 'set', '--enabled', 'yes', '--expected-version', '1'], request), /true or false/)
    assert.equal(calls.length, 3)
  })
  it('sends a report through the central alias and rejects malformed transfer mappings', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'report-cli-'))
    const body = join(directory, 'report.md')
    const map = join(directory, 'labels.json')
    writeFileSync(body, 'Expected and actual behavior')
    writeFileSync(map, '{invalid')
    const calls = []
    const request = async (...args) => { calls.push(args); return {} }
    try {
      await execute(['report', 'create', '--product', 'plans', '--routing-version', 'reviewed-route', '--title', 'A problem', '--body-file', body, '--idempotency-key', 'report-retry-01'], request)
      assert.deepEqual(calls[0], ['POST', '/api/reports', { productKey: 'plans', routingVersion: 'reviewed-route', title: 'A problem', body: 'Expected and actual behavior' }, { idempotencyKey: 'report-retry-01' }])
      await assert.rejects(execute(['issue', 'transfer', '--id', 'one', '--product', 'plans', '--expected-version', '1', '--label-map-file', map], request), /JSON/)
      assert.equal(calls.length, 1)
    }
    finally { rmSync(directory, { recursive: true, force: true }) }
  })
})

describe('native issue relation CLI', () => {
  it('adds, reads and removes explicit relations using stable IDs', async () => {
    const calls = []
    const request = async (...args) => { calls.push(args); return {} }
    await execute(['issue', 'link', '--id', 'one', '--pull-repo', 'owner/project', '--pull-number', '7'], request)
    await execute(['issue', 'links', '--id', 'one'], request)
    await execute(['pr', 'issues', '7', '--repo', 'owner/project'], request)
    await execute(['issue', 'unlink', '--id', 'one', '--pull-id', 'pull'], request)
    assert.deepEqual(calls[0].slice(0, 3), ['POST', '/api/issue-records/one/pulls', { repository: 'owner/project', number: 7 }])
    assert.equal(calls[1][1], '/api/issue-records/one/pulls')
    assert.equal(calls[2][1], '/api/repos/owner/project/pulls/7/issues')
    assert.equal(calls[3][0], 'DELETE')
    await assert.rejects(execute(['issue', 'link', '--id', 'one', '--pull-repo', '../private', '--pull-number', '7'], request), /owner\/name/)
    assert.equal(calls.length, 4)
  })
})
