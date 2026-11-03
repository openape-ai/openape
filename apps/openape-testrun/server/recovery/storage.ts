import type { ObjectStore, ObjectValue, RecoveryConfig } from './types'
import { lstat, readFile } from 'node:fs/promises'
import { AwsClient } from 'aws4fetch'

const MAX_OBJECT_BYTES = 64 * 1024 * 1024
export async function readRecoveryConfig(path: string): Promise<RecoveryConfig> {
  const info = await lstat(path)
  if (!info.isFile() || (info.mode & 0o077)) throw new Error('Recovery configuration must be a private regular file')
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovery configuration')
  const config = value as Record<string, unknown>
  for (const key of ['endpoint', 'region', 'bucket', 'prefix', 'accessKeyId', 'secretAccessKey', 'encryptionKey']) {
    if (typeof config[key] !== 'string' || !config[key]) throw new Error(`Recovery configuration requires ${key}`)
  }
  const result = config as unknown as RecoveryConfig
  const endpoint = new URL(result.endpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('Recovery requires an HTTPS object-storage origin')
  if (!/^[a-z0-9][a-z0-9.-]+$/.test(result.bucket) || !/^[\w-]+(?:\/[\w-]+)*$/.test(result.prefix)) throw new Error('Invalid recovery bucket or prefix')
  const key = Buffer.from(result.encryptionKey, 'base64')
  if (key.length !== 32 || key.toString('base64') !== result.encryptionKey) throw new Error('Recovery encryption requires a canonical 32-byte base64 key')
  return result
}
async function boundedBody(response: Response) {
  if (Number(response.headers.get('content-length')) > MAX_OBJECT_BYTES) throw new Error('Recovery object exceeds the size boundary')
  if (!response.body) throw new Error('Recovery object body is missing')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.length
      if (bytes > MAX_OBJECT_BYTES) { await reader.cancel(); throw new Error('Recovery object exceeds the size boundary') }
      chunks.push(next.value)
    }
  }
  finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}
export function s3RecoveryStore(config: RecoveryConfig): ObjectStore {
  const client = new AwsClient({ service: 's3', region: config.region, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, retries: 0 })
  function url(key: string) {
    if (key !== 'head' && !/^records\/\d+-[a-f0-9-]+$/.test(key)) throw new Error('Invalid recovery object key')
    return `${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${config.prefix}/${key}`
  }
  function etag(response: Response) {
    const value = response.headers.get('etag')
    if (!value) throw new Error('Recovery storage response lacks an ETag; outcome requires reconciliation')
    return value
  }
  return {
    async get(key): Promise<ObjectValue | null> {
      const response = await client.fetch(url(key), { method: 'GET', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000) })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Recovery object read failed: HTTP ${response.status}`)
      return { bytes: await boundedBody(response), etag: etag(response) }
    },
    async put(key, bytes, expected) {
      const response = await client.fetch(url(key), { method: 'PUT', body: new Uint8Array(bytes).buffer, headers: { 'content-type': 'application/octet-stream', ...(expected === null ? { 'if-none-match': '*' } : { 'if-match': expected }) }, signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(`Recovery conditional write failed: HTTP ${response.status}`)
      return etag(response)
    },
  }
}
