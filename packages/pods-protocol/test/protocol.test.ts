import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assertFresh, capabilities, negotiateCapabilities, parseCommand, parseEnvelope, parseRoute, sameOwner } from '../src/index'
import type { Route } from '../src/index'
import { generateKey, open, publicKey, seal } from '../src/crypto'

const route = (): Route => ({ protocol: 'pods-mobile', major: 1, minor: 0, id: randomUUID(), runtimeId: randomUUID(), generation: randomUUID(), deviceId: randomUUID(), keyEpoch: 1, owner: { issuer: 'https://id.example', subject: 'owner@example.test' }, direction: 'command', kind: 'pod.create', kindVersion: 1, issuedAt: '2026-09-20T12:00:00.000Z', expiresAt: '2026-09-20T12:05:00.000Z', sequence: '0' })
describe('remote boundary', () => {
  it('negotiates only mutually supported operations without dropping encryption requirements', () => {
    expect(negotiateCapabilities({ ...capabilities, minor: 3, commands: ['pod.create', 'future.command'], queries: ['inventory'] })).toEqual({ ...capabilities, commands: ['pod.create'], queries: ['inventory'] })
    expect(() => negotiateCapabilities({ ...capabilities, major: 2 })).toThrow('unsupported_version')
    expect(() => negotiateCapabilities({ ...capabilities, contentModes: ['plaintext'] })).toThrow('encryption_required')
  })
  it('rejects capability expansion, unreviewed runs and unknown versions', () => {
    expect(() => parseCommand('pod.create', { name: 'Example', approved: true })).toThrow('invalid_fields')
    expect(() => parseCommand('run.start', { podId: randomUUID(), expected: { podRevision: 1, resourceEpoch: 0 } })).toThrow('script_review_required')
    expect(() => parseRoute({ ...route(), major: 2 })).toThrow('unsupported_version')
    expect(() => parseRoute({ ...route(), kind: 'shell' })).toThrow('unsupported_operation')
    expect(() => parseEnvelope({ route: route(), contentMode: 'plaintext' })).toThrow('encryption_required')
  })
  it('separates equal subjects from different issuers and expires before dispatch', () => {
    expect(sameOwner(route().owner, { issuer: 'https://attacker.example', subject: 'owner@example.test' })).toBe(false)
    expect(() => assertFresh(route(), Date.parse('2026-09-20T12:05:00.000Z'))).toThrow('operation_expired')
    expect(() => assertFresh(route(), Date.parse('2026-09-20T11:58:00.000Z'))).toThrow('clock_skew')
  })
  it('protects content and authenticates routing, recipient and ciphertext', () => {
    const sender = generateKey(); const recipient = generateKey()
    const envelope = seal(route(), { name: 'Private Pod' }, publicKey(recipient), sender)
    expect(JSON.stringify(envelope)).not.toContain('Private Pod')
    expect(open(envelope, recipient, publicKey(sender))).toEqual({ name: 'Private Pod' })
    expect(() => open({ ...envelope, route: { ...envelope.route, runtimeId: randomUUID() } }, recipient, publicKey(sender))).toThrow('invalid_signature')
    expect(() => open(envelope, generateKey(), publicKey(sender))).toThrow()
    expect(() => open(envelope, recipient, publicKey(generateKey()))).toThrow('invalid_signature')
  })
})

it('opens the retained CryptoKit fixture produced by the native client', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/encrypted-v1.json', import.meta.url), 'utf8'))
  const envelope = JSON.parse(readFileSync(new URL('../fixtures/swift-encrypted-v1.json', import.meta.url), 'utf8'))
  expect(open(envelope, fixture.recipient, fixture.senderPublic)).toEqual({ name: 'Synthetic Pod ✓' })
})

it('always emits fixed-width private scalars compatible with CryptoKit', () => {
  for (let sample = 0; sample < 4096; sample++) {
    const key = generateKey()
    expect(Buffer.from(key, 'base64url')).toHaveLength(32)
    expect(Buffer.from(publicKey(key), 'base64url')).toHaveLength(65)
  }
})
