import type { SealedBox } from '../crypto/sealed-box.js'
import { describe, expect, it } from 'vitest'
import {
  generateX25519KeyPair,
  open,
  openString,
  seal,
} from '../crypto/sealed-box.js'

describe('sealed-box', () => {
  it('round-trips a UTF-8 string', () => {
    const kp = generateX25519KeyPair()
    const box = seal('hunter2-🔐', kp.publicKey)
    expect(box.v).toBe(1)
    expect(openString(box, kp.privateKey)).toBe('hunter2-🔐')
  })

  it('round-trips binary data', () => {
    const kp = generateX25519KeyPair()
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 42])
    const out = open(seal(bytes, kp.publicKey), kp.privateKey)
    expect(Buffer.from(out)).toEqual(Buffer.from(bytes))
  })

  it('round-trips an empty payload', () => {
    const kp = generateX25519KeyPair()
    expect(openString(seal('', kp.publicKey), kp.privateKey)).toBe('')
  })

  it('produces different ciphertext each time (ephemeral key + IV)', () => {
    const kp = generateX25519KeyPair()
    const a = seal('same', kp.publicKey)
    const b = seal('same', kp.publicKey)
    expect(a.ct).not.toBe(b.ct)
    expect(a.epk).not.toBe(b.epk)
    expect(a.iv).not.toBe(b.iv)
    expect(openString(a, kp.privateKey)).toBe('same')
    expect(openString(b, kp.privateKey)).toBe('same')
  })

  it('cannot be opened with a different key', () => {
    const a = generateX25519KeyPair()
    const b = generateX25519KeyPair()
    const box = seal('secret', a.publicKey)
    expect(() => open(box, b.privateKey)).toThrow()
  })

  it('rejects a tampered ciphertext', () => {
    const kp = generateX25519KeyPair()
    const box = seal('secret', kp.publicKey)
    const ct = Buffer.from(box.ct, 'base64url')
    ct[0] = (ct[0] ?? 0) ^ 0xFF
    const tampered: SealedBox = { ...box, ct: ct.toString('base64url') }
    expect(() => open(tampered, kp.privateKey)).toThrow()
  })

  it('rejects a tampered auth tag', () => {
    const kp = generateX25519KeyPair()
    const box = seal('secret', kp.publicKey)
    const tag = Buffer.from(box.tag, 'base64url')
    tag[0] = (tag[0] ?? 0) ^ 0xFF
    expect(() => open({ ...box, tag: tag.toString('base64url') }, kp.privateKey)).toThrow()
  })

  it('rejects an unsupported version', () => {
    const kp = generateX25519KeyPair()
    const box = seal('x', kp.publicKey)
    expect(() => open({ ...box, v: 2 as 1 }, kp.privateKey)).toThrow(/unsupported sealed-box version: 2/)
  })

  it('rejects a wrong-length ephemeral public key', () => {
    const kp = generateX25519KeyPair()
    const box = seal('x', kp.publicKey)
    expect(() => open({ ...box, epk: Buffer.alloc(31).toString('base64url') }, kp.privateKey))
      .toThrow(/invalid ephemeral public key length/)
  })

  it('rejects a wrong-length IV', () => {
    const kp = generateX25519KeyPair()
    const box = seal('x', kp.publicKey)
    expect(() => open({ ...box, iv: Buffer.alloc(8).toString('base64url') }, kp.privateKey))
      .toThrow(/invalid IV length/)
  })

  it('rejects a wrong-length auth tag', () => {
    const kp = generateX25519KeyPair()
    const box = seal('x', kp.publicKey)
    expect(() => open({ ...box, tag: Buffer.alloc(15).toString('base64url') }, kp.privateKey))
      .toThrow(/invalid auth tag length/)
  })

  it('generates self-contained DER-encoded base64url keys', () => {
    const kp = generateX25519KeyPair()
    expect(kp.publicKey).toMatch(/^[\w-]+$/)
    expect(kp.privateKey).toMatch(/^[\w-]+$/)
    expect(kp.publicKey).not.toBe(kp.privateKey)
  })
})
