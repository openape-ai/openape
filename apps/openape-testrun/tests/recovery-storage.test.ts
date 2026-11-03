import type { RecoveryConfig } from '../server/recovery/types'
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readRecoveryConfig, s3RecoveryStore } from '../server/recovery/storage'

let directory: string
let config: RecoveryConfig
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reports-storage-'))
  config = { endpoint: 'https://storage.example.test', region: 'test-1', bucket: 'recovery', prefix: 'reports/fixture', accessKeyId: 'synthetic-key', secretAccessKey: 'synthetic-secret', encryptionKey: randomBytes(32).toString('base64') }
})
afterEach(() => { vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }) })

describe('Reports external recovery storage boundary', () => {
  it('requires a private regular configuration file and canonical encryption key', async () => {
    const path = join(directory, 'config.json')
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
    expect(await readRecoveryConfig(path)).toEqual(config)
    chmodSync(path, 0o644)
    await expect(readRecoveryConfig(path)).rejects.toThrow('private regular file')
    chmodSync(path, 0o600)
    symlinkSync(path, join(directory, 'link.json'))
    await expect(readRecoveryConfig(join(directory, 'link.json'))).rejects.toThrow('private regular file')
    writeFileSync(path, JSON.stringify({ ...config, endpoint: 'http://storage.example.test' }))
    await expect(readRecoveryConfig(path)).rejects.toThrow('HTTPS')
    writeFileSync(path, JSON.stringify({ ...config, encryptionKey: 'not-a-key' }))
    await expect(readRecoveryConfig(path)).rejects.toThrow('32-byte')
  })

  it('signs conditional writes and does not retry an ambiguous response', async () => {
    const requests: Request[] = []
    vi.stubGlobal('fetch', async (request: Request) => { requests.push(request); return new Response(null, { status: 200, headers: { etag: '"revision"' } }) })
    const store = s3RecoveryStore(config)
    await store.put('head', new Uint8Array([1]), null)
    await store.put('head', new Uint8Array([2]), '"revision"')
    expect(requests[0]?.headers.get('if-none-match')).toBe('*')
    expect(requests[1]?.headers.get('if-match')).toBe('"revision"')
    expect(requests[0]?.headers.get('authorization')).toContain('AWS4-HMAC-SHA256')
    expect(requests[0]?.url).toBe('https://storage.example.test/recovery/reports/fixture/head')
    const fail = vi.fn(async () => { throw new Error('Synthetic transport loss') })
    vi.stubGlobal('fetch', fail)
    await expect(store.put('head', new Uint8Array([3]), '"revision"')).rejects.toThrow('transport loss')
    expect(fail).toHaveBeenCalledTimes(1)
  })

  it('refuses failed conditional writes, missing ETags, oversized data and unsafe keys', async () => {
    const store = s3RecoveryStore(config)
    vi.stubGlobal('fetch', async () => new Response(null, { status: 412 }))
    await expect(store.put('head', new Uint8Array(), '"old"')).rejects.toThrow('HTTP 412')
    vi.stubGlobal('fetch', async () => new Response('ciphertext', { status: 200 }))
    await expect(store.get('head')).rejects.toThrow('ETag')
    vi.stubGlobal('fetch', async () => new Response('ciphertext', { status: 200, headers: { etag: '"x"', 'content-length': String(65 * 1024 * 1024) } }))
    await expect(store.get('head')).rejects.toThrow('size boundary')
    await expect(store.get('../backup')).rejects.toThrow('object key')
    vi.stubGlobal('fetch', async () => new Response(null, { status: 403 }))
    await expect(store.get('head')).rejects.toThrow('HTTP 403')
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    expect(await store.get('head')).toBe(null)
  })
})
