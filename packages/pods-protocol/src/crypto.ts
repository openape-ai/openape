import { createECDH, createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { base64url, ProtocolError } from './index'

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
export const challenge = (value: string): string => createHash('sha256').update(value).digest('base64url')
export function publicKey(privateKey: string): string {
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(Buffer.from(base64url(privateKey, 32), 'base64url'))
  return ecdh.getPublicKey().toString('base64url')
}
export function generateKey(): string {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys()
  const scalar = ecdh.getPrivateKey()
  const fixedWidth = Buffer.alloc(32); scalar.copy(fixedWidth, 32 - scalar.length)
  return fixedWidth.toString('base64url')
}
function jwk(raw: string, privateKey?: string) {
  const bytes = Buffer.from(base64url(raw, 65), 'base64url')
  if (bytes[0] !== 4) throw new ProtocolError('invalid_public_key')
  return { kty: 'EC', crv: 'P-256', x: bytes.subarray(1, 33).toString('base64url'), y: bytes.subarray(33).toString('base64url'), ...(privateKey ? { d: privateKey } : {}) }
}
export function signBytes(bytes: Uint8Array, privateKey: string): string {
  return sign('sha256', bytes, { key: createPrivateKey({ format: 'jwk', key: jwk(publicKey(privateKey), privateKey) }), dsaEncoding: 'ieee-p1363' }).toString('base64url')
}
export function verifyBytes(bytes: Uint8Array, signature: string, key: string): boolean {
  try {
    return verify('sha256', bytes, { key: createPublicKey({ format: 'jwk', key: jwk(key) }), dsaEncoding: 'ieee-p1363' }, Buffer.from(base64url(signature, 64), 'base64url'))
  }
  catch { return false }
}
export function proofBytes(purpose: string, id: string, nonce: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(['pods-mobile-proof', 1, purpose, id, nonce]))
}
