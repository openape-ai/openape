import { describe, expect, it } from 'vitest'
import { serializeCredential } from '../app/utils/vault-browser'
import { createVaultEngine } from '../app/utils/vault-engine'
import type { WrappedKey } from '@openape/ape-secrets/vault'
import { randomKey } from '@openape/ape-secrets/vault'

describe('browser secret boundary', () => {
  it('never serializes PRF extension outputs into a WebAuthn response', () => {
    const value = new Uint8Array([1, 2, 3]).buffer
    const credential = { id: 'id', rawId: value, type: 'public-key', response: { clientDataJSON: value, authenticatorData: value, signature: value, userHandle: null }, getClientExtensionResults: () => ({ prf: { results: { first: 'sensitive-prf-output' } } }) } as unknown as PublicKeyCredential
    expect(serializeCredential(credential).clientExtensionResults).toEqual({})
    expect(JSON.stringify(serializeCredential(credential))).not.toContain('sensitive-prf-output')
  })
  it('clears PRF inputs and rejects use after locking or with the wrong passkey', async () => {
    const engine = createVaultEngine()
    const prf = randomKey(); const saved = prf.slice()
    const setup = await engine({ type: 'setup', owner: 'owner', credentialId: 'credential', prf }) as { wrapper: WrappedKey }
    expect(prf.every(v => v === 0)).toBe(true)
    await engine({ type: 'clear' })
    await expect(engine({ type: 'save', value: 'secret', owner: 'owner', secretId: 'id', version: 1 })).rejects.toThrow('Unlock required')
    await expect(engine({ type: 'unlock', owner: 'owner', credentialId: 'other', prf: saved.slice(), wrapper: setup.wrapper })).rejects.toThrow()
    await engine({ type: 'unlock', owner: 'owner', credentialId: 'credential', prf: saved, wrapper: setup.wrapper })
    expect(saved.every(v => v === 0)).toBe(true)
    expect(await engine({ type: 'save', value: 'secret', owner: 'owner', secretId: 'id', version: 1 })).toHaveProperty('value.ct')
  })
})
