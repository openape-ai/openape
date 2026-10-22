/** Browser/Node WebCrypto only. Never import this module into a server handler. */
export interface Box { iv: string, ct: string }
export interface WrappedKey { salt: string, box: Box }
export interface SecretPayload { value: Box, key: Box }
export interface DeliveryContext {
  owner: string
  requester: string
  consumerId: string
  fingerprint: string
  secretId: string
  version: number
  approvalId: string
  mode: 'once' | 'timed' | 'standing'
  expiresAt: number | null
}
export interface Envelope { format: 'openape.secrets/2', context: DeliveryContext, epk: string, salt: string, box: Box }
const encoder = new TextEncoder()
export const bytes = (value: string) => encoder.encode(value)
export function encode(value: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(value instanceof Uint8Array ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer : value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
export function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]+$/.test(value)) throw new Error('Invalid base64url')
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
}
export const randomKey = () => crypto.getRandomValues(new Uint8Array(32))
export function context(value: DeliveryContext): string {
  return JSON.stringify(['openape.secrets/2', value.owner, value.requester, value.consumerId, value.fingerprint, value.secretId, value.version, value.approvalId, value.mode, value.expiresAt])
}
export async function fingerprint(jwk: JsonWebKey): Promise<string> {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || jwk.d) throw new Error('Public P-256 key required')
  await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  return encode(await crypto.subtle.digest('SHA-256', bytes(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))))
}
async function aes(raw: Uint8Array<ArrayBuffer>, usage: KeyUsage[]) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usage)
}
async function derive(raw: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: string) {
  const key = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: bytes(info) }, key, 256))
}
export async function encrypt(raw: Uint8Array<ArrayBuffer>, plaintext: Uint8Array<ArrayBuffer>, aad: string): Promise<Box> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return { iv: encode(iv), ct: encode(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(aad) }, await aes(raw, ['encrypt']), plaintext)) }
}
export async function decrypt(raw: Uint8Array<ArrayBuffer>, box: Box, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(box.iv), additionalData: bytes(aad) }, await aes(raw, ['decrypt']), decode(box.ct)))
}
export async function wrapData(vmk: Uint8Array<ArrayBuffer>, prf: Uint8Array<ArrayBuffer>, binding: string): Promise<WrappedKey> {
  if (prf.length !== 32) throw new Error('256-bit wrapping key required')
  const salt = randomKey()
  const key = await derive(prf, salt, `openape.secrets.wrap/2:${binding}`)
  try { return { salt: encode(salt), box: await encrypt(key, vmk, binding) } }
  finally { key.fill(0) }
}
export async function unwrapData(wrapper: WrappedKey, prf: Uint8Array<ArrayBuffer>, binding: string) {
  const key = await derive(prf, decode(wrapper.salt), `openape.secrets.wrap/2:${binding}`)
  try { return await decrypt(key, wrapper.box, binding) }
  finally { key.fill(0) }
}
export const secretContext = (owner: string, id: string, version: number) => JSON.stringify(['openape.secret/2', owner, id, version])
export async function encryptSecret(vmk: Uint8Array<ArrayBuffer>, value: string, owner: string, id: string, version: number): Promise<SecretPayload> {
  if (bytes(value).length > 32768) throw new Error('Secret exceeds 32 KiB')
  const dek = randomKey()
  const aad = secretContext(owner, id, version)
  const plaintext = bytes(value)
  try { return { value: await encrypt(dek, plaintext, aad), key: await encrypt(vmk, dek, `${aad}:key`) } }
  finally { dek.fill(0); plaintext.fill(0) }
}
export async function decryptSecret(vmk: Uint8Array<ArrayBuffer>, payload: SecretPayload, owner: string, id: string, version: number) {
  const aad = secretContext(owner, id, version)
  const dek = await decrypt(vmk, payload.key, `${aad}:key`)
  try { return await decrypt(dek, payload.value, aad) }
  finally { dek.fill(0) }
}
export async function sealDelivery(jwk: JsonWebKey, plaintext: Uint8Array<ArrayBuffer>, descriptor: DeliveryContext): Promise<Envelope> {
  if (await fingerprint(jwk) !== descriptor.fingerprint) throw new Error('Recipient key changed')
  const recipient = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: recipient }, pair.privateKey, 256))
  const salt = randomKey()
  const aad = context(descriptor)
  const key = await derive(shared, salt, aad)
  try {
    return { format: 'openape.secrets/2', context: descriptor, epk: encode(await crypto.subtle.exportKey('raw', pair.publicKey)), salt: encode(salt), box: await encrypt(key, plaintext, aad) }
  }
  finally { shared.fill(0); key.fill(0) }
}
export async function openDelivery(jwk: JsonWebKey, envelope: Envelope, expected: DeliveryContext) {
  if (envelope.format !== 'openape.secrets/2' || context(envelope.context) !== context(expected)) throw new Error('Delivery context mismatch')
  const { d: _private, ...publicKey } = jwk
  delete publicKey.key_ops
  if (await fingerprint(publicKey) !== expected.fingerprint) throw new Error('Wrong recipient key')
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const epk = await crypto.subtle.importKey('raw', decode(envelope.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, key, 256))
  const derived = await derive(shared, decode(envelope.salt), context(expected))
  try { return await decrypt(derived, envelope.box, context(expected)) }
  finally { shared.fill(0); derived.fill(0) }
}

export async function wrapVault(vmk: Uint8Array<ArrayBuffer>, prf: Uint8Array<ArrayBuffer>, binding: string) {
  if (vmk.length !== 32) throw new Error('256-bit vault key required')
  const wrapped = await wrapData(vmk, prf, binding)
  const check = await unwrapData(wrapped, prf, binding)
  try {
    if (!check.every((v, i) => v === vmk[i]) || check.length !== vmk.length) throw new Error('Vault wrapping verification failed')
    return wrapped
  }
  finally { check.fill(0) }
}
export async function unwrapVault(wrapper: WrappedKey, prf: Uint8Array<ArrayBuffer>, binding: string) {
  const key = await unwrapData(wrapper, prf, binding)
  if (key.length !== 32) { key.fill(0); throw new Error('Invalid vault key') }
  return key
}
export const credentialBinding = (owner: string, id: string) => JSON.stringify(['credential', owner, id])
export const recoveryBinding = (owner: string, id: string, purpose: 'vault' | 'signing') => JSON.stringify(['recovery', owner, id, purpose])
