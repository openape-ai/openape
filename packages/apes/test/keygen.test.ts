import { openString, seal } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { generateKeyPairInMemory } from '../src/lib/keygen'

describe('generateKeyPairInMemory', () => {
  it('produces an ed25519 auth key and an X25519 encryption key', () => {
    const kp = generateKeyPairInMemory()
    expect(kp.privatePem).toContain('BEGIN PRIVATE KEY')
    expect(kp.publicSshLine).toMatch(/^ssh-ed25519 /)
    expect(kp.x25519PrivateKey).toMatch(/^[\w-]+$/)
    expect(kp.x25519PublicKey).toMatch(/^[\w-]+$/)
    expect(kp.x25519PrivateKey).not.toBe(kp.x25519PublicKey)
  })

  it('X25519 keypair round-trips a sealed secret (troop seals, agent opens)', () => {
    const kp = generateKeyPairInMemory()
    const box = seal('BLUESKY_APP_PASSWORD=hunter2', kp.x25519PublicKey)
    expect(openString(box, kp.x25519PrivateKey)).toBe('BLUESKY_APP_PASSWORD=hunter2')
  })

  it('a different agent cannot open another agent\'s sealed secret', () => {
    const a = generateKeyPairInMemory()
    const b = generateKeyPairInMemory()
    const box = seal('secret', a.x25519PublicKey)
    expect(() => openString(box, b.x25519PrivateKey)).toThrow()
  })
})
