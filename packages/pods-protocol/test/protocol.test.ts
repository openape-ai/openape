import { expect, it } from 'vitest'
import { parseKeys, parseOwner, sameOwner } from '../src/index'
import { generateKey, proofBytes, publicKey, signBytes, verifyBytes } from '../src/crypto'

it('separates equal subjects from different issuers and refuses issuers with credentials', () => {
  const owner = parseOwner({ issuer: 'https://id.example', subject: 'owner@example.test' })
  expect(sameOwner(owner, { issuer: 'https://attacker.example', subject: 'owner@example.test' })).toBe(false)
  expect(() => parseOwner({ issuer: 'https://user:secret@id.example', subject: 'owner@example.test' })).toThrow('invalid_issuer')
  expect(() => parseOwner({ ...owner, extra: true })).toThrow('invalid_fields')
})

it('signs request proofs over the installed desktop tuple and refuses other keys or purposes', () => {
  const key = generateKey()
  const keys = parseKeys({ signing: publicKey(key), agreement: publicKey(generateKey()) })
  const bytes = proofBytes('api-request', 'request-id', 'nonce')
  expect(new TextDecoder().decode(bytes)).toBe('["pods-mobile-proof",1,"api-request","request-id","nonce"]')
  const signature = signBytes(bytes, key)
  expect(verifyBytes(bytes, signature, keys.signing)).toBe(true)
  expect(verifyBytes(proofBytes('session-refresh', 'request-id', 'nonce'), signature, keys.signing)).toBe(false)
  expect(verifyBytes(bytes, signature, publicKey(generateKey()))).toBe(false)
  expect(() => parseKeys({ signing: 'short', agreement: keys.agreement })).toThrow('invalid_encoding')
})

it('always emits fixed-width private scalars', () => {
  for (let sample = 0; sample < 4096; sample++) {
    const key = generateKey()
    expect(Buffer.from(key, 'base64url')).toHaveLength(32)
    expect(Buffer.from(publicKey(key), 'base64url')).toHaveLength(65)
  }
})
