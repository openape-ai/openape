import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const SALT = 'openape-crm-graph'

export function encryptSecret(plain: string, secret: string): string {
  const key = scryptSync(secret, SALT, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64url')
}

export function decryptSecret(blob: string, secret: string): string {
  const buf = Buffer.from(blob, 'base64url')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const key = scryptSync(secret, SALT, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
