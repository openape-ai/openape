import { describe, expect, it, vi } from 'vitest'

// The service must be unable to read what it stores, and unable to leak which
// machines belong to whom. Both are tested by their refusals: a happy path here
// proves almost nothing on its own.
vi.mock('../server/database/drizzle', async () => {
  const { createClient } = await import('@libsql/client')
  const { drizzle } = await import('drizzle-orm/libsql')
  const schema = await import('../server/database/schema')
  const client = createClient({ url: 'file::memory:?cache=shared' })
  await client.execute(`CREATE TABLE consumers (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, name TEXT NOT NULL, public_key_jwk TEXT NOT NULL, allowed_requesters TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE secret_requests (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, requester TEXT NOT NULL, consumer_id TEXT NOT NULL, field_name TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'requested', expires_at INTEGER NOT NULL, box_epk TEXT, box_salt TEXT, box_iv TEXT, box_ct TEXT, created_at INTEGER NOT NULL, filled_at INTEGER, fetched_at INTEGER)`)
  return { useDb: () => drizzle(client, { schema }) }
})

let caller = 'patrick@hofmann.eco'
// requireCaller is a Nitro auto-import from @openape/nuxt-auth-sp; outside Nuxt
// it resolves through globalThis.
vi.stubGlobal('requireCaller', async () => ({ email: caller, act: 'human' }))

// The handlers import these from 'h3', so a global stub would not intercept.
vi.mock('h3', () => ({
  defineEventHandler: (fn: unknown) => fn,
  readBody: async (e: { __body: unknown }) => e.__body,
  getRouterParam: (e: { context: { params: Record<string, string> } }, k: string) => e.context.params[k],
  setResponseStatus: () => {},
  createError: (opts: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(opts.statusMessage ?? 'error'), { statusCode: opts.statusCode, data: opts.data }),
}))

const { isP256PublicJwk } = await import('../server/api/consumers/index.post')
const { mayRequestFor } = await import('../server/utils/access')
const { isLapsed, toRequestView } = await import('../server/utils/request-view')
const createConsumer = (await import('../server/api/consumers/index.post')).default
const createRequest = (await import('../server/api/requests/index.post')).default
const readRequest = (await import('../server/api/requests/[id].get')).default
const fillRequest = (await import('../server/api/requests/[id]/fill.post')).default
const cancelRequest = (await import('../server/api/requests/[id]/cancel.post')).default

const PUB = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' }

function event(body?: unknown, params?: Record<string, string>) {
  return { __body: body, context: { params: params ?? {} }, node: { res: {} } } as never
}

describe('the stored view can never carry the envelope', () => {
  it('drops every box_* column, even when they are populated', () => {
    const view = toRequestView({
      id: 'r1', ownerEmail: 'o@x', requester: 'a@x', consumerId: 'c1', fieldName: 'TOKEN',
      purpose: '', status: 'filled', expiresAt: 0, createdAt: 0, filledAt: 1, fetchedAt: null,
      boxEpk: 'EPK', boxSalt: 'SALT', boxIv: 'IV', boxCt: 'CIPHERTEXT',
    })
    const dumped = JSON.stringify(view)
    for (const secret of ['EPK', 'SALT', 'IV', 'CIPHERTEXT']) expect(dumped).not.toContain(secret)
  })
})

describe('a consumer key must be a public P-256 JWK', () => {
  it('accepts the public half', () => {
    expect(isP256PublicJwk(PUB)).toBe(true)
  })
  it('refuses a key carrying the private component', () => {
    expect(isP256PublicJwk({ ...PUB, d: 'private!' })).toBe(false)
  })
  it('refuses another curve', () => {
    expect(isP256PublicJwk({ ...PUB, crv: 'P-384' })).toBe(false)
  })
  it('refuses junk', () => {
    expect(isP256PublicJwk(null)).toBe(false)
    expect(isP256PublicJwk('ssh-ed25519 AAAA')).toBe(false)
  })
})

describe('who may raise a request', () => {
  const consumer = { id: 'c', ownerEmail: 'owner@x', name: 'mac', publicKeyJwk: '{}', allowedRequesters: '["agent@x"]', createdAt: 0 }
  it('the owner may', () => expect(mayRequestFor(consumer, 'owner@x')).toBe(true))
  it('a listed agent may', () => expect(mayRequestFor(consumer, 'agent@x')).toBe(true))
  it('a stranger may not', () => expect(mayRequestFor(consumer, 'fremd@x')).toBe(false))
  it('nobody may when the allowlist is corrupt — fail closed', () => {
    expect(mayRequestFor({ ...consumer, allowedRequesters: 'not json' }, 'agent@x')).toBe(false)
  })
})

describe('end to end over the real handlers', () => {
  it('creates a request, and hides it from everyone else', async () => {
    caller = 'patrick@hofmann.eco'
    const consumer = await createConsumer(event({ name: 'mac mini', publicKeyJwk: PUB })) as { id: string }
    expect(consumer.id).toBeTruthy()

    const req = await createRequest(event({ consumerId: consumer.id, fieldName: 'NUXT_TELEGRAM_BOT_TOKEN', purpose: 'Bot für den OpenApe-Operator' })) as { id: string, status: string, owner: string }
    expect(req.status).toBe('requested')
    expect(req.owner).toBe('patrick@hofmann.eco')

    // The owner sees it, and gets the key to seal against.
    const mine = await readRequest(event(undefined, { id: req.id })) as Record<string, unknown>
    expect(mine.consumer_public_key_jwk).toMatchObject(PUB)

    // A stranger does not — 403, and not a 404 that would still confirm nothing.
    caller = 'fremd@example.com'
    await expect(readRequest(event(undefined, { id: req.id }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses to raise a request against a consumer the caller may not use', async () => {
    caller = 'patrick@hofmann.eco'
    const consumer = await createConsumer(event({ name: 'privat', publicKeyJwk: PUB })) as { id: string }

    caller = 'fremd@example.com'
    // 404, not 403: a distinct answer here would enumerate someone else's machines.
    await expect(createRequest(event({ consumerId: consumer.id, fieldName: 'X' }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('refuses a request without a consumer instead of silently going plaintext', async () => {
    caller = 'patrick@hofmann.eco'
    await expect(createRequest(event({ fieldName: 'X' }))).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('a request nobody filled in time is dead', () => {
  it('lapses once the deadline passes', () => {
    expect(isLapsed({ status: 'requested', expiresAt: 1000 }, 1000)).toBe(true)
    expect(isLapsed({ status: 'requested', expiresAt: 1000 }, 999)).toBe(false)
  })
  it('says nothing about one that was already filled', () => {
    expect(isLapsed({ status: 'filled', expiresAt: 1 }, 9999)).toBe(false)
  })
})

describe('handing a value over', () => {
  const BOX = { epk: 'EPK', salt: 'SALT', iv: 'IV', ct: 'CIPHERTEXT' }

  async function freshRequest() {
    caller = 'patrick@hofmann.eco'
    const consumer = await createConsumer(event({ name: 'mac', publicKeyJwk: PUB })) as { id: string }
    return await createRequest(event({ consumerId: consumer.id, fieldName: 'TOKEN' })) as { id: string }
  }

  it('accepts a complete envelope once', async () => {
    const req = await freshRequest()
    const filled = await fillRequest(event({ box: BOX }, { id: req.id })) as { status: string }
    expect(filled.status).toBe('filled')
  })

  it('refuses a second fill — a gate you can fill twice is not one', async () => {
    const req = await freshRequest()
    await fillRequest(event({ box: BOX }, { id: req.id }))
    await expect(fillRequest(event({ box: BOX }, { id: req.id }))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses a half envelope instead of storing part of it', async () => {
    const req = await freshRequest()
    await expect(fillRequest(event({ box: { epk: 'a', salt: 'b', iv: 'c' } }, { id: req.id }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lets nobody but the owner fill it — not even the requester', async () => {
    const req = await freshRequest()
    caller = 'fremd@example.com'
    await expect(fillRequest(event({ box: BOX }, { id: req.id }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('never returns the envelope it just took', async () => {
    const req = await freshRequest()
    const filled = await fillRequest(event({ box: BOX }, { id: req.id }))
    expect(JSON.stringify(filled)).not.toContain('CIPHERTEXT')
  })

  it('declining closes the request and stores nothing', async () => {
    const req = await freshRequest()
    const cancelled = await cancelRequest(event(undefined, { id: req.id })) as { status: string }
    expect(cancelled.status).toBe('cancelled')
    await expect(fillRequest(event({ box: BOX }, { id: req.id }))).rejects.toMatchObject({ statusCode: 409 })
  })
})
