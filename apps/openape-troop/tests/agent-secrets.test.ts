import { generateX25519KeyPair, openString } from '@openape/core'
import { describe, expect, it } from 'vitest'
import {
  buildSecretRevokeFrame,
  buildSecretUpdateFrame,
  deserializeSealed,
  sealSecret,
  serializeSealed,
  validateEnvName,
} from '../server/utils/agent-secrets'

describe('validateEnvName', () => {
  it.each(['BLUESKY_APP_PASSWORD', 'X', 'A1_B2'])('accepts %s', (e) => {
    expect(validateEnvName(e).ok).toBe(true)
  })
  it.each(['lower', '1LEADING', 'HAS-DASH', 'HAS SPACE', ''])('rejects %s', (e) => {
    const r = validateEnvName(e)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/UPPER_SNAKE/)
  })
})

describe('sealSecret', () => {
  it('seals to the agent pubkey so only the agent can open it', () => {
    const kp = generateX25519KeyPair()
    const box = sealSecret(kp.publicKey, 'hunter2')
    expect(openString(box, kp.privateKey)).toBe('hunter2')
  })

  it.each([null, undefined, ''])('throws when the agent has no pubkey (%s)', (pk) => {
    expect(() => sealSecret(pk as string | null, 'x')).toThrow(/no X25519 public key/)
  })
})

describe('serialize/deserialize', () => {
  it('round-trips a sealed box through storage form', () => {
    const kp = generateX25519KeyPair()
    const box = sealSecret(kp.publicKey, 'v')
    const restored = deserializeSealed(serializeSealed(box))
    expect(openString(restored, kp.privateKey)).toBe('v')
  })
})

describe('frame builders', () => {
  it('builds a secret-update frame carrying the serialized blob', () => {
    const kp = generateX25519KeyPair()
    const box = sealSecret(kp.publicKey, 's')
    const f = buildSecretUpdateFrame('agent-a+p+h_eco@id.openape.ai', 'TOKEN', box)
    expect(f.type).toBe('secret-update')
    expect(f.agent_email).toBe('agent-a+p+h_eco@id.openape.ai')
    expect(f.env).toBe('TOKEN')
    expect(openString(deserializeSealed(f.blob), kp.privateKey)).toBe('s')
  })

  it('builds a secret-revoke frame', () => {
    const f = buildSecretRevokeFrame('agent-a@id.openape.ai', 'TOKEN')
    expect(f).toEqual({ type: 'secret-revoke', agent_email: 'agent-a@id.openape.ai', env: 'TOKEN' })
  })
})
