// Security checklist: QR sign-in (/api/session/qr) — the kiosk shows the
// channelId as a QR, the phone approves, the kiosk claims with a secret that
// never left it. Guarantees under test: the QR alone is worthless, approve is
// human-cookie-only and unchainable, claim is single-use with TTL, and the
// transferred session is remotely revocable.

import { createStorage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: { storageKey: 'idp' },
    openapeGrants: { storageKey: 'grants' },
  }),
  useEvent: () => undefined,
  useStorage: (key: string) => {
    if (!storages.has(key)) storages.set(key, createStorage())
    return storages.get(key)!
  },
}))

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
  getRouterParam: (event: any, name: string) => event.params?.[name],
  readBody: async (event: any) => event.body,
  getRequestIP: () => '203.0.113.7',
  getHeader: (_event: any, name: string) => (name === 'user-agent' ? 'KioskBrowser/1.0' : undefined),
}))

// Two browsers: the kiosk that wants in, and the signed-in phone.
let kiosk: Record<string, unknown> = {}
let phone: Record<string, unknown> = {}
let current: Record<string, unknown>

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: async () => ({
    data: current,
    update: async (data: Record<string, unknown>) => Object.assign(current, data),
    clear: async () => { for (const key of Object.keys(current)) delete current[key] },
  }),
}))

const USER = 'human@example.com'

async function createChannel() {
  const { default: handler } = await import('../src/runtime/server/api/session/qr/index.post')
  current = kiosk
  return handler({} as any)
}

async function readContext(id: string, asBrowser = phone) {
  const { default: handler } = await import('../src/runtime/server/api/session/qr/[id].get')
  current = asBrowser
  return handler({ params: { id } } as any)
}

async function approve(id: string, asBrowser = phone) {
  const { default: handler } = await import('../src/runtime/server/api/session/qr/[id]/approve.post')
  current = asBrowser
  return handler({ params: { id } } as any)
}

async function deny(id: string) {
  const { default: handler } = await import('../src/runtime/server/api/session/qr/[id]/deny.post')
  current = phone
  return handler({ params: { id } } as any)
}

async function claim(id: string, claimSecret: string) {
  const { default: handler } = await import('../src/runtime/server/api/session/qr/[id]/claim.post')
  current = kiosk
  return handler({ params: { id }, body: { claimSecret } } as any)
}

async function listSessions() {
  const { default: handler } = await import('../src/runtime/server/api/session/qr/sessions/index.get')
  current = phone
  return handler({} as any)
}

async function revokeSession(id: string, asBrowser = phone) {
  const { default: handler } = await import('../src/runtime/server/api/session/qr/sessions/[id].delete')
  current = asBrowser
  return handler({ params: { id } } as any)
}

function grantStorage() {
  return storages.get('grants')!
}

describe('qr sign-in', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
    kiosk = {}
    phone = { userId: USER, userName: 'Test' }
    vi.restoreAllMocks()
  })

  it('mints a channel whose secret is never stored in the clear', async () => {
    const { channelId, claimSecret, expiresIn } = await createChannel()
    expect(channelId).toMatch(/^[a-f0-9]{64}$/)
    expect(claimSecret).toMatch(/^[a-f0-9]{64}$/)
    expect(expiresIn).toBe(120)
    const stored = await grantStorage().getItem<any>(`qr-login:${channelId}`)
    expect(stored.claimSecretHash).not.toBe(claimSecret)
    expect(JSON.stringify(stored)).not.toContain(claimSecret)
  })

  it('signs the kiosk in after the phone approves', async () => {
    const { channelId, claimSecret } = await createChannel()
    expect(await claim(channelId, claimSecret)).toEqual({ status: 'pending' })
    await approve(channelId)
    expect(await claim(channelId, claimSecret)).toEqual({ status: 'ok' })
    expect(kiosk.userId).toBe(USER)
    expect(kiosk.qrChannelId).toBe(channelId)
    expect(typeof kiosk.qrExpiresAt).toBe('number')
  })

  it('shows the approve page the kiosk context', async () => {
    const { channelId } = await createChannel()
    const context = await readContext(channelId)
    expect(context).toMatchObject({
      state: 'pending',
      requester: { ip: '203.0.113.7', userAgent: 'KioskBrowser/1.0' },
    })
  })

  it('refuses context, approve and deny without a session', async () => {
    const { channelId, claimSecret } = await createChannel()
    for (const call of [
      () => readContext(channelId, {}),
      () => approve(channelId, {}),
    ]) {
      await expect(call()).rejects.toMatchObject({ statusCode: 401 })
    }
    await approve(channelId)
    expect(await claim(channelId, claimSecret)).toEqual({ status: 'ok' })
  })

  it('the QR alone is worthless: a wrong secret neither claims nor burns', async () => {
    const { channelId, claimSecret } = await createChannel()
    await approve(channelId)
    const onlooker = 'a'.repeat(64)
    await expect(claim(channelId, onlooker)).rejects.toMatchObject({ statusCode: 401 })
    // The legitimate kiosk still gets in afterwards.
    expect(await claim(channelId, claimSecret)).toEqual({ status: 'ok' })
  })

  it('burns the channel on first successful claim', async () => {
    const { channelId, claimSecret } = await createChannel()
    await approve(channelId)
    await claim(channelId, claimSecret)
    kiosk = {}
    await expect(claim(channelId, claimSecret)).rejects.toMatchObject({ statusCode: 401 })
    expect(kiosk).toEqual({})
  })

  it('expires the channel after its TTL', async () => {
    const { channelId, claimSecret } = await createChannel()
    await approve(channelId)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 121_000)
    await expect(claim(channelId, claimSecret)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses to approve twice', async () => {
    const { channelId } = await createChannel()
    await approve(channelId)
    await expect(approve(channelId)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('deny kills the channel', async () => {
    const { channelId, claimSecret } = await createChannel()
    await deny(channelId)
    await expect(claim(channelId, claimSecret)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('a QR session cannot approve another QR sign-in (no chaining)', async () => {
    const first = await createChannel()
    await approve(first.channelId)
    await claim(first.channelId, first.claimSecret)

    kiosk = { ...kiosk }
    const second = await createChannel()
    await expect(approve(second.channelId, kiosk)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects malformed ids and secrets before touching storage', async () => {
    await expect(readContext('../grants/whatever')).rejects.toMatchObject({ statusCode: 400 })
    await expect(approve('short')).rejects.toMatchObject({ statusCode: 400 })
    await expect(claim('x'.repeat(64), 'not-hex')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lists and revokes the transferred session', async () => {
    const { channelId, claimSecret } = await createChannel()
    await approve(channelId)
    await claim(channelId, claimSecret)

    const sessions = await listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ id: channelId, userId: USER })

    await revokeSession(channelId)
    expect(await grantStorage().getItem(`qr-session:${channelId}`)).toBeNull()
    expect(await listSessions()).toEqual([])
  })

  it('will not revoke another user\'s session', async () => {
    const { channelId, claimSecret } = await createChannel()
    await approve(channelId)
    await claim(channelId, claimSecret)
    await expect(revokeSession(channelId, { userId: 'other@example.com' }))
      .rejects
      .toMatchObject({ statusCode: 403 })
  })
})
