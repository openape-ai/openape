import { describe, expect, it } from 'vitest'
import {
  createRecovery,
  createSigningKey,
  credentialKek,
  ctx,
  formatRecoveryCode,
  keyFingerprint,
  newRecoverySecret,
  openDelivery,
  openRecovery,
  openSecret,
  openSigningKey,
  parseRecoveryCode,
  sealDelivery,
  sealSecret,
  signDelivery,
  unwrapVmk,
  verifyDelivery,
  verifyRecoveryProof,
  wrapVmk,
} from '../shared/vault-crypto'

// The vault is only as good as its refusals: every test that proves a value
// opens is paired with the context swap, wrong key or tampering that must not.

const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))
const ids = { vaultId: 'v1', secretId: 's1', version: 3 }

describe('context encoding', () => {
  it('cannot be confused by moving bytes between parts', () => {
    expect(ctx('p', 'ab', 'c')).not.toEqual(ctx('p', 'a', 'bc'))
    expect(ctx('pa', 'b')).not.toEqual(ctx('p', 'ab'))
  })

  it('is versioned and deterministic', () => {
    const a = ctx('vmk-wrap', 'v1', 'c1')
    expect(new TextDecoder().decode(a)).toContain('openape-secrets/v2')
    expect(a).toEqual(ctx('vmk-wrap', 'v1', 'c1'))
  })
})

describe('vault master key wrapped per credential', () => {
  it('opens with the same PRF output, salt and credential', async () => {
    const prf = rnd(32)
    const salt = rnd(32)
    const vmk = rnd(32)
    const sealed = await wrapVmk(await credentialKek(prf, salt, 'v1', 'c1'), vmk, 'v1', 'c1')
    expect(await unwrapVmk(await credentialKek(prf, salt, 'v1', 'c1'), sealed, 'v1', 'c1')).toEqual(vmk)
  })

  it('refuses a different PRF output', async () => {
    const salt = rnd(32)
    const sealed = await wrapVmk(await credentialKek(rnd(32), salt, 'v1', 'c1'), rnd(32), 'v1', 'c1')
    await expect(unwrapVmk(await credentialKek(rnd(32), salt, 'v1', 'c1'), sealed, 'v1', 'c1')).rejects.toThrow()
  })

  it('refuses a wrapper moved to another credential or vault', async () => {
    const prf = rnd(32)
    const salt = rnd(32)
    const sealed = await wrapVmk(await credentialKek(prf, salt, 'v1', 'c1'), rnd(32), 'v1', 'c1')
    await expect(unwrapVmk(await credentialKek(prf, salt, 'v1', 'c2'), sealed, 'v1', 'c2')).rejects.toThrow()
    await expect(unwrapVmk(await credentialKek(prf, salt, 'v2', 'c1'), sealed, 'v2', 'c1')).rejects.toThrow()
  })

  it('refuses a tampered ciphertext', async () => {
    const prf = rnd(32)
    const salt = rnd(32)
    const sealed = await wrapVmk(await credentialKek(prf, salt, 'v1', 'c1'), rnd(32), 'v1', 'c1')
    const ct = sealed.ct.slice(0, -2) + (sealed.ct.endsWith('AA') ? 'AB' : 'AA')
    await expect(unwrapVmk(await credentialKek(prf, salt, 'v1', 'c1'), { ...sealed, ct }, 'v1', 'c1')).rejects.toThrow()
  })
})

describe('secret versions', () => {
  it('open with the vault key in their own context', async () => {
    const vmk = rnd(32)
    const sealed = await sealSecret(vmk, 'tg-token-123', ids)
    expect(await openSecret(vmk, sealed, ids)).toBe('tg-token-123')
  })

  it('never contain the plaintext and use a fresh key each time', async () => {
    const vmk = rnd(32)
    const a = await sealSecret(vmk, 'tg-token-123', ids)
    const b = await sealSecret(vmk, 'tg-token-123', ids)
    expect(JSON.stringify(a)).not.toContain('tg-token-123')
    expect(a.dek.ct).not.toBe(b.dek.ct)
    expect(a.value.ct).not.toBe(b.value.ct)
  })

  it('refuse a swapped secret, version or vault', async () => {
    const vmk = rnd(32)
    const sealed = await sealSecret(vmk, 'x', ids)
    await expect(openSecret(vmk, sealed, { ...ids, secretId: 's2' })).rejects.toThrow()
    await expect(openSecret(vmk, sealed, { ...ids, version: 4 })).rejects.toThrow()
    await expect(openSecret(vmk, sealed, { ...ids, vaultId: 'v2' })).rejects.toThrow()
  })

  it('refuse another vault key', async () => {
    const sealed = await sealSecret(rnd(32), 'x', ids)
    await expect(openSecret(rnd(32), sealed, ids)).rejects.toThrow()
  })
})

describe('recovery code', () => {
  it('shows 32 bytes as 13 groups of 4 Crockford characters', () => {
    const code = formatRecoveryCode(rnd(32))
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4} ){12}[0-9A-HJKMNP-TV-Z]{4}$/)
  })

  it('reads back what it showed, forgiving case, dashes and look-alikes', () => {
    const secret = rnd(32)
    const code = formatRecoveryCode(secret)
    expect(parseRecoveryCode(code)).toEqual(secret)
    const sloppy = code.toLowerCase().replaceAll(' ', '-').replaceAll('0', 'o').replaceAll('1', 'l')
    expect(parseRecoveryCode(sloppy)).toEqual(secret)
  })

  it('refuses a code of the wrong length or with foreign characters', () => {
    const code = formatRecoveryCode(rnd(32))
    expect(() => parseRecoveryCode(code.slice(0, -1))).toThrow()
    expect(() => parseRecoveryCode(`${code.slice(0, -1)}U`)).toThrow()
  })
})

describe('recovery', () => {
  it('returns the vault key and proves possession to the server', async () => {
    const vmk = rnd(32)
    const secret = newRecoverySecret()
    const record = await createRecovery(vmk, secret, 'v1')
    const opened = await openRecovery(secret, record, 'v1')
    expect(opened.vmk).toEqual(vmk)
    const challenge = 'server-challenge-1'
    expect(await verifyRecoveryProof(record.proofPublicJwk, challenge, await opened.sign(challenge))).toBe(true)
  })

  it('refuses the wrong recovery secret or another vault', async () => {
    const record = await createRecovery(rnd(32), newRecoverySecret(), 'v1')
    await expect(openRecovery(newRecoverySecret(), record, 'v1')).rejects.toThrow()
    await expect(openRecovery(newRecoverySecret(), record, 'v2')).rejects.toThrow()
  })

  it('does not accept a proof for a different challenge', async () => {
    const secret = newRecoverySecret()
    const record = await createRecovery(rnd(32), secret, 'v1')
    const opened = await openRecovery(secret, record, 'v1')
    expect(await verifyRecoveryProof(record.proofPublicJwk, 'challenge-b', await opened.sign('challenge-a'))).toBe(false)
  })

  it('stores nothing that reveals the vault key or the recovery secret', async () => {
    const vmk = rnd(32)
    const secret = newRecoverySecret()
    const stored = JSON.stringify(await createRecovery(vmk, secret, 'v1'))
    expect(stored).not.toContain(Buffer.from(vmk).toString('base64url'))
    expect(stored).not.toContain(Buffer.from(secret).toString('base64url'))
    expect(stored).not.toContain('"d"')
  })
})

describe('key fingerprint', () => {
  it('is the RFC 7638 thumbprint of the P-256 public key', async () => {
    // Expected value computed independently with Python hashlib over the
    // canonical member ordering {"crv","kty","x","y"}.
    const jwk = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0', ext: true }
    expect(await keyFingerprint(jwk)).toBe('A0A232C2F194A53553CB1310DDBC0821E414B9D7EBFC290B323084D7D1020FE5')
  })
})

describe('delivery package', () => {
  async function machineKey() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey)
    const publicJwk = { kty, crv, x, y }
    return { publicJwk, privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey), fingerprint: await keyFingerprint(publicJwk) }
  }
  const delivery = (fingerprint: string) => ({ approvalId: 'a1', consumerKeyFingerprint: fingerprint, secretId: 's1', version: 3 })

  it('opens only on the machine it was sealed for, in its own context', async () => {
    const machine = await machineKey()
    const pkg = await sealDelivery(machine.publicJwk, 'tg-token-123', delivery(machine.fingerprint))
    expect(JSON.stringify(pkg)).not.toContain('tg-token-123')
    expect(await openDelivery(machine.privateJwk, pkg, delivery(machine.fingerprint))).toBe('tg-token-123')
  })

  it('refuses another machine\'s key', async () => {
    const machine = await machineKey()
    const other = await machineKey()
    const pkg = await sealDelivery(machine.publicJwk, 'x', delivery(machine.fingerprint))
    await expect(openDelivery(other.privateJwk, pkg, delivery(machine.fingerprint))).rejects.toThrow()
  })

  it('refuses a package moved to another approval, version or secret', async () => {
    const machine = await machineKey()
    const ctx = delivery(machine.fingerprint)
    const pkg = await sealDelivery(machine.publicJwk, 'x', ctx)
    await expect(openDelivery(machine.privateJwk, pkg, { ...ctx, approvalId: 'a2' })).rejects.toThrow()
    await expect(openDelivery(machine.privateJwk, pkg, { ...ctx, version: 4 })).rejects.toThrow()
    await expect(openDelivery(machine.privateJwk, pkg, { ...ctx, secretId: 's2' })).rejects.toThrow()
  })

  it('will not seal for a key whose fingerprint differs from the approved one', async () => {
    const machine = await machineKey()
    const swapped = await machineKey()
    await expect(sealDelivery(swapped.publicJwk, 'x', delivery(machine.fingerprint))).rejects.toThrow()
  })
})

describe('vault-signed packages', () => {
  async function signed() {
    const vmk = rnd(32)
    const record = await createSigningKey(vmk, 'v1')
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey)
    const machine = { kty, crv, x, y }
    const context = { vaultId: 'v1', approvalId: 'a1', consumerKeyFingerprint: await keyFingerprint(machine), secretId: 's1', version: 2 }
    const pkg = await sealDelivery(machine, 'value', context)
    const signature = await signDelivery(await openSigningKey(vmk, record, 'v1'), pkg, context)
    return { vmk, record, pkg, context, signature }
  }

  it('verifies with the vault\'s public signing key', async () => {
    const { record, pkg, context, signature } = await signed()
    expect(await verifyDelivery(record.publicJwk, pkg, context, signature)).toBe(true)
  })

  it('fails for a changed package, context or vault, or another vault\'s key', async () => {
    const { record, pkg, context, signature } = await signed()
    const other = await createSigningKey(rnd(32), 'v2')
    const ct = pkg.ct.slice(0, -2) + (pkg.ct.endsWith('AA') ? 'AB' : 'AA')
    expect(await verifyDelivery(record.publicJwk, { ...pkg, ct }, context, signature)).toBe(false)
    expect(await verifyDelivery(record.publicJwk, pkg, { ...context, approvalId: 'a2' }, signature)).toBe(false)
    expect(await verifyDelivery(record.publicJwk, pkg, { ...context, vaultId: 'v2' }, signature)).toBe(false)
    expect(await verifyDelivery(other.publicJwk, pkg, context, signature)).toBe(false)
  })

  it('keeps the private signing key locked under the vault key', async () => {
    const { record } = await signed()
    expect(JSON.stringify(record)).not.toContain('"d"')
    await expect(openSigningKey(rnd(32), record, 'v1')).rejects.toThrow()
  })
})
