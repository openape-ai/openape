import { randomBytes, createHash } from 'node:crypto'

const API_KEY_PREFIX = 'amk_'
const KEY_BYTES = 32

export function generateApiKey(): { key: string, hash: string } {
  const raw = randomBytes(KEY_BYTES).toString('base64url')
  const key = `${API_KEY_PREFIX}${raw}`
  const hash = hashApiKey(key)
  return { key, hash }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}
