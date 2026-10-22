import { describe, expect, it } from 'vitest'
import { bytes, credentialBinding, decryptSecret, encryptSecret, fingerprint, openDelivery, randomKey, sealDelivery, unwrapVault, wrapVault } from '../src/vault-crypto'

describe('vault cryptography', () => {
  it('binds wrappers to credential and owner, and values to ID and version', async () => {
    const vmk = randomKey(); const prf = randomKey(); const binding = credentialBinding('owner', 'credential')
    const wrapped = await wrapVault(vmk, prf, binding)
    expect(await unwrapVault(wrapped, prf, binding)).toEqual(vmk)
    await expect(unwrapVault(wrapped, randomKey(), binding)).rejects.toThrow()
    await expect(unwrapVault(wrapped, prf, credentialBinding('other', 'credential'))).rejects.toThrow()
    const payload = await encryptSecret(vmk, 'the-secret', 'owner', 'secret-id', 1)
    expect(await decryptSecret(vmk, payload, 'owner', 'secret-id', 1)).toEqual(bytes('the-secret'))
    await expect(decryptSecret(vmk, payload, 'owner', 'secret-id', 2)).rejects.toThrow()
    await expect(decryptSecret(vmk, payload, 'other', 'secret-id', 1)).rejects.toThrow()
  })
  it('authenticates every recipient and release context field', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey); const priv = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const context = { owner: 'owner', requester: 'agent', consumerId: 'machine', fingerprint: await fingerprint(pub), secretId: 'secret', version: 1, approvalId: 'approval', mode: 'once' as const, expiresAt: 42 }
    const e = await sealDelivery(pub, bytes('private'), context)
    expect(await openDelivery(priv, e, context)).toEqual(bytes('private'))
    for (const [key, value] of Object.entries(context)) {
      const changed = { ...context, [key]: typeof value === 'number' ? value + 1 : `${value}X` }
      await expect(openDelivery(priv, { ...e, context: changed }, changed)).rejects.toThrow()
    }
    await expect(openDelivery(priv, { ...e, box: { ...e.box, ct: `${e.box.ct.slice(0, -4)}AAAA` } }, context)).rejects.toThrow()
  })
})
