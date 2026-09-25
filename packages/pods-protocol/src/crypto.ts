import { createCipheriv, createDecipheriv, createECDH, createHash, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign, verify } from 'node:crypto'
import { base64url, parseEnvelope, ProtocolError, routeBytes } from './index'
import type { Route, SealedEnvelope } from './index'

export interface PrivateKeys { signing: string, agreement: string }
const info = Buffer.from('OpenApe Pods encrypted-v1 P256 HKDF-SHA256 AES256GCM')
const signatureDomain = Buffer.from('OpenApe Pods envelope-v1\0')
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
function symmetricKey(privateKey: string, peerKey: string, associated: Uint8Array): Buffer {
  const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(base64url(privateKey, 32), 'base64url'))
  const secret = ecdh.computeSecret(Buffer.from(base64url(peerKey, 65), 'base64url'))
  return Buffer.from(hkdfSync('sha256', secret, createHash('sha256').update(associated).digest(), info, 32))
}
function signedBytes(envelope: Omit<SealedEnvelope, 'signature'>): Buffer {
  return Buffer.concat([signatureDomain, Buffer.from(routeBytes(envelope.route)), Buffer.from([0]), Buffer.from(envelope.ephemeralKey, 'base64url'), Buffer.from(envelope.nonce, 'base64url'), Buffer.from(envelope.ciphertext, 'base64url')])
}
export function seal(route: Route, value: unknown, recipientAgreement: string, senderSigning: string): SealedEnvelope {
  const ephemeral = generateKey()
  const associated = routeBytes(route)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', symmetricKey(ephemeral, recipientAgreement, associated), nonce)
  cipher.setAAD(associated)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url')
  const unsigned: Omit<SealedEnvelope, 'signature'> = { route, contentMode: 'encrypted-v1', ephemeralKey: publicKey(ephemeral), nonce: nonce.toString('base64url'), ciphertext }
  return parseEnvelope({ ...unsigned, signature: signBytes(signedBytes(unsigned), senderSigning) })
}
export function open(value: unknown, recipientAgreement: string, senderSigning: string): unknown {
  const envelope = parseEnvelope(value)
  if (!verifyBytes(signedBytes(envelope), envelope.signature, senderSigning)) throw new ProtocolError('invalid_signature', 403)
  const associated = routeBytes(envelope.route)
  const data = Buffer.from(envelope.ciphertext, 'base64url')
  if (data.length < 16) throw new ProtocolError('invalid_ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', symmetricKey(recipientAgreement, envelope.ephemeralKey, associated), Buffer.from(envelope.nonce, 'base64url'))
  decipher.setAAD(associated); decipher.setAuthTag(data.subarray(-16))
  try { return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8')) }
  catch { throw new ProtocolError('invalid_ciphertext', 403) }
}
export function verifyEnvelope(value: unknown, senderSigning: string): SealedEnvelope {
  const envelope = parseEnvelope(value)
  if (!verifyBytes(signedBytes(envelope), envelope.signature, senderSigning)) throw new ProtocolError('invalid_signature', 403)
  return envelope
}
export function proofBytes(purpose: string, id: string, nonce: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(['pods-mobile-proof', 1, purpose, id, nonce]))
}

export function envelopeDigest(envelope: SealedEnvelope): string { return sha256(signedBytes(envelope)) }
