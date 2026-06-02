import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ofetchMock = vi.fn()
vi.mock('ofetch', () => ({ ofetch: (...args: unknown[]) => ofetchMock(...args) }))

const { mintNestToken, readDeviceCreds, troopHttpUrl } = await import('../src/lib/nest-device')

const ENV_KEYS = ['OPENAPE_NEST_HOST_ID', 'OPENAPE_NEST_DEVICE_SECRET', 'OPENAPE_NEST_DEVICE_PATH'] as const
let saved: Record<string, string | undefined>
let dir: string

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  dir = mkdtempSync(join(tmpdir(), 'nest-device-'))
  ofetchMock.mockReset()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(dir, { recursive: true, force: true })
})

function writeCredsFile(body: unknown): string {
  const p = join(dir, 'nest-device.json')
  writeFileSync(p, JSON.stringify(body))
  return p
}

describe('readDeviceCreds', () => {
  it('reads creds from env vars', () => {
    process.env.OPENAPE_NEST_HOST_ID = 'mbp-home'
    process.env.OPENAPE_NEST_DEVICE_SECRET = 'sekret'
    expect(readDeviceCreds()).toEqual({ hostId: 'mbp-home', deviceSecret: 'sekret' })
  })

  it('env vars win over the file', () => {
    process.env.OPENAPE_NEST_HOST_ID = 'from-env'
    process.env.OPENAPE_NEST_DEVICE_SECRET = 'env-secret'
    process.env.OPENAPE_NEST_DEVICE_PATH = writeCredsFile({ host_id: 'from-file', device_secret: 'file-secret' })
    expect(readDeviceCreds()).toEqual({ hostId: 'from-env', deviceSecret: 'env-secret' })
  })

  it('falls back to the file when env vars are absent', () => {
    process.env.OPENAPE_NEST_DEVICE_PATH = writeCredsFile({ host_id: 'mbp-home', device_secret: 'file-secret' })
    expect(readDeviceCreds()).toEqual({ hostId: 'mbp-home', deviceSecret: 'file-secret' })
  })

  it('returns null when neither source is present', () => {
    process.env.OPENAPE_NEST_DEVICE_PATH = join(dir, 'does-not-exist.json')
    expect(readDeviceCreds()).toBeNull()
  })

  it('returns null when the file is missing a field', () => {
    process.env.OPENAPE_NEST_DEVICE_PATH = writeCredsFile({ host_id: 'mbp-home' })
    expect(readDeviceCreds()).toBeNull()
  })

  it('returns null for a half-set env (host only)', () => {
    process.env.OPENAPE_NEST_HOST_ID = 'mbp-home'
    process.env.OPENAPE_NEST_DEVICE_PATH = join(dir, 'does-not-exist.json')
    expect(readDeviceCreds()).toBeNull()
  })
})

describe('troopHttpUrl', () => {
  it('rewrites wss/ws to https/http', () => {
    expect(troopHttpUrl('wss://troop.openape.ai')).toBe('https://troop.openape.ai')
    expect(troopHttpUrl('ws://localhost:3000')).toBe('http://localhost:3000')
  })
})

describe('mintNestToken', () => {
  it('posts host_id+device_secret to the https mint endpoint and returns the token', async () => {
    ofetchMock.mockResolvedValue({ access_token: 'tok-123', expires_at: 1781234567 })
    const out = await mintNestToken('wss://troop.openape.ai', { hostId: 'mbp-home', deviceSecret: 'sekret' })
    expect(out).toEqual({ token: 'tok-123', expiresAt: 1781234567 })
    expect(ofetchMock).toHaveBeenCalledWith(
      'https://troop.openape.ai/api/nests/token',
      { method: 'POST', body: { host_id: 'mbp-home', device_secret: 'sekret' } },
    )
  })

  it('surfaces a mint failure (401 → revoked/bad secret) as a throw', async () => {
    ofetchMock.mockRejectedValue(new Error('401 Unauthorized'))
    await expect(mintNestToken('wss://troop.openape.ai', { hostId: 'x', deviceSecret: 'y' }))
      .rejects
      .toThrow('401')
  })
})
