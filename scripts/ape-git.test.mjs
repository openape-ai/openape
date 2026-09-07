import assert from 'node:assert/strict'
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
