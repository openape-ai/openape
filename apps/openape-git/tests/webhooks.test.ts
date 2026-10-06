import { describe, expect, it } from 'vitest'
import { parseRefUpdates } from '../server/hooks/post-receive.mjs'
import { isValidSha } from '../server/utils/git-parse'
import { summarizeStatuses } from '../server/utils/statuses'
import { archivePayload, isFreshTimestamp, sign, verifySignature, webhookTargetError } from '../server/utils/webhooks'

const SECRET = 'a'.repeat(64)

describe('webhook signatures', () => {
  it('accepts its own signature', () => {
    const body = '{"event":"push"}'
    expect(verifySignature(body, SECRET, sign(body, SECRET))).toBe(true)
  })

  it('rejects a tampered body', () => {
    const signature = sign('{"repo":"patrick/demo"}', SECRET)
    expect(verifySignature('{"repo":"mallory/demo"}', SECRET, signature)).toBe(false)
  })

  it('rejects another secret', () => {
    const body = '{"event":"push"}'
    expect(verifySignature(body, 'b'.repeat(64), sign(body, SECRET))).toBe(false)
  })

  it('rejects a missing or malformed signature', () => {
    expect(verifySignature('body', SECRET, undefined)).toBe(false)
    expect(verifySignature('body', SECRET, 'sha256=')).toBe(false)
  })
})

describe('signed archive requests', () => {
  it('binds repo, sha and timestamp together', () => {
    const payload = archivePayload('patrick', 'demo', 'a'.repeat(40), '1000')
    // Same secret, different repo -> different signature: a capture cannot be
    // replayed against another repo.
    expect(sign(payload, SECRET)).not.toBe(sign(archivePayload('mallory', 'demo', 'a'.repeat(40), '1000'), SECRET))
  })

  it('only accepts timestamps inside the skew window', () => {
    expect(isFreshTimestamp('1000', 1000)).toBe(true)
    expect(isFreshTimestamp('1000', 1200)).toBe(true)
    expect(isFreshTimestamp('1000', 1400)).toBe(false)
    expect(isFreshTimestamp('1000', 500)).toBe(false)
    expect(isFreshTimestamp(undefined, 1000)).toBe(false)
    expect(isFreshTimestamp('not-a-number', 1000)).toBe(false)
  })
})

describe('isValidSha', () => {
  it('takes full lowercase shas only', () => {
    expect(isValidSha('a'.repeat(40))).toBe(true)
    expect(isValidSha('a'.repeat(39))).toBe(false)
    expect(isValidSha('A'.repeat(40))).toBe(false)
    expect(isValidSha('../../etc/passwd')).toBe(false)
  })
})

describe('parseRefUpdates', () => {
  it('reads the ref lines git feeds a receive hook', () => {
    const stdin = `${'0'.repeat(40)} ${'b'.repeat(40)} refs/heads/main\n${'c'.repeat(40)} ${'d'.repeat(40)} refs/tags/v1\n`
    expect(parseRefUpdates(stdin)).toEqual([
      { before: '0'.repeat(40), after: 'b'.repeat(40), ref: 'refs/heads/main' },
      { before: 'c'.repeat(40), after: 'd'.repeat(40), ref: 'refs/tags/v1' },
    ])
  })

  it('ignores blank lines', () => {
    expect(parseRefUpdates('\n\n')).toEqual([])
  })
})

describe('summarizeStatuses', () => {
  it('shows the worst state per commit', () => {
    const summary = summarizeStatuses([
      { sha: 'x', state: 'success', targetUrl: 'https://forge/ok' },
      { sha: 'x', state: 'failure', targetUrl: 'https://forge/bad' },
      { sha: 'y', state: 'pending', targetUrl: null },
    ])
    expect(summary.get('x')).toEqual({ state: 'failure', targetUrl: 'https://forge/bad' })
    expect(summary.get('y')).toEqual({ state: 'pending', targetUrl: null })
  })

  it('keeps failure when a later success arrives for another context', () => {
    const summary = summarizeStatuses([
      { sha: 'x', state: 'failure', targetUrl: null },
      { sha: 'x', state: 'success', targetUrl: null },
    ])
    expect(summary.get('x')?.state).toBe('failure')
  })

  it('ignores states it does not know', () => {
    expect(summarizeStatuses([{ sha: 'x', state: 'exploded', targetUrl: null }]).size).toBe(0)
  })
})

describe('webhookTargetError', () => {
  it('blocks the cloud metadata address, however it is spelled', () => {
    // Decimal, octal and hex normalize to dotted-decimal in the URL parser;
    // the IPv4-mapped IPv6 form does not, which is why it is checked apart.
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://2852039166/',
      'http://0xa9fea9fe/',
      'http://0251.0376.0251.0376/',
      'http://[::ffff:169.254.169.254]/',
      'http://[::ffff:a9fe:a9fe]/',
    ])
      expect(webhookTargetError(url), url).toMatch(/link-local/)
  })

  it('leaves a consumer on the private network alone', () => {
    expect(webhookTargetError('http://ci:8080/hook')).toBeNull()
    expect(webhookTargetError('https://consumer.example/hook')).toBeNull()
  })

  it('rejects anything that is not http(s)', () => {
    expect(webhookTargetError('file:///etc/passwd')).toMatch(/http/)
    expect(webhookTargetError('not a url')).toMatch(/http/)
  })
})
