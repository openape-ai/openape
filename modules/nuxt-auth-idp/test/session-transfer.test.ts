// Security checklist: session transfer (/api/session/transfer) — the link is a
// bearer credential, so the guarantees under test are single-use, TTL, session
// binding, and that only a minted token shape reaches storage.

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
  getRequestURL: () => new URL('https://id.openape.test/account'),
  getRouterParam: (event: any, name: string) => event.params?.[name],
  sendRedirect: async (_event: any, location: string) => ({ redirect: location }),
}))

// Two independent browsers: the one that mints the link, and the one that opens it.
let source: Record<string, unknown> = {}
let target: Record<string, unknown> = {}
let current: Record<string, unknown>

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: async () => ({
    data: current,
    update: async (data: Record<string, unknown>) => Object.assign(current, data),
  }),
}))

const USER = 'human@example.com'

async function createLink() {
  const { default: handler } = await import('../src/runtime/server/api/session/transfer.post')
  current = source
  return handler({} as any)
}

async function openLink(token: string) {
  const { default: handler } = await import('../src/runtime/server/api/session/transfer/[token].get')
  current = target
  return handler({ params: { token } } as any)
}

function tokenOf(url: string) {
  return url.split('/').pop()!
}

describe('session transfer', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
    source = { userId: USER, userName: 'Test', isSuperAdmin: true }
    target = {}
  })

  it('refuses to mint a link without a session', async () => {
    source = {}
    await expect(createLink()).rejects.toMatchObject({ statusCode: 401 })
  })

  it('signs the other browser in as the same user', async () => {
    const { url } = await createLink()
    expect(await openLink(tokenOf(url))).toEqual({ redirect: '/' })
    expect(target).toEqual({ userId: USER, userName: 'Test', isSuperAdmin: true })
  })

  it('burns the token on first use', async () => {
    const { url } = await createLink()
    await openLink(tokenOf(url))
    target = {}
    await expect(openLink(tokenOf(url))).rejects.toMatchObject({ statusCode: 401 })
    expect(target).toEqual({})
  })

  it('expires after its TTL', async () => {
    const { url, expiresIn } = await createLink()
    expect(expiresIn).toBe(60)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    await expect(openLink(tokenOf(url))).rejects.toMatchObject({ statusCode: 401 })
    vi.restoreAllMocks()
  })

  it('rejects a token that is not a minted one', async () => {
    await expect(openLink('../grants/whatever')).rejects.toMatchObject({ statusCode: 400 })
    await expect(openLink('short')).rejects.toMatchObject({ statusCode: 400 })
  })
})
