import { describe, expect, it, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../server/database/schema'
import { generateApiKey } from '../../server/utils/api-key'

const { mailboxes } = schema

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  sqlite.exec(`
    CREATE TABLE mailboxes (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      domain_id TEXT NOT NULL,
      local_part TEXT NOT NULL,
      address TEXT NOT NULL UNIQUE,
      api_key_hash TEXT NOT NULL,
      total_size_bytes INTEGER DEFAULT 0,
      soft_cap_bytes INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `)
  return db
}

let db: ReturnType<typeof createTestDb>

vi.mock('../../server/utils/db', () => ({
  useDb: () => db,
}))

// Re-import middleware after mock
const mod = await import('../../server/middleware/agent-auth')
const handler = mod.default.__handler ?? mod.default

function createMockEvent(path: string, authHeader?: string) {
  return {
    path,
    context: {} as any,
    node: { req: { headers: authHeader ? { authorization: authHeader } : {} } },
  } as any
}

// Mock h3 functions used by the middleware
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3')
  return {
    ...actual,
    getHeader: (event: any, name: string) => {
      return event.node?.req?.headers?.[name]
    },
    defineEventHandler: (fn: any) => {
      const wrapper = fn
      wrapper.__handler = fn
      return wrapper
    },
  }
})

describe('agent-auth middleware', () => {
  beforeEach(() => {
    db = createTestDb()
  })

  it('skips non-agent paths', async () => {
    const event = createMockEvent('/api/v1/admin/domains')
    const result = await handler(event)
    expect(result).toBeUndefined()
    expect(event.context.mailbox).toBeUndefined()
  })

  it('skips webhook paths', async () => {
    const event = createMockEvent('/api/v1/webhooks/inbound')
    const result = await handler(event)
    expect(result).toBeUndefined()
  })

  it('rejects requests without auth header on /api/v1/messages', async () => {
    const event = createMockEvent('/api/v1/messages')
    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('rejects requests without auth header on /api/v1/mailbox', async () => {
    const event = createMockEvent('/api/v1/mailbox')
    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('rejects invalid Bearer prefix', async () => {
    const event = createMockEvent('/api/v1/messages', 'Bearer invalid_key')
    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('rejects unknown API key', async () => {
    const event = createMockEvent('/api/v1/messages', 'Bearer amk_unknown-key')
    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('attaches mailbox to context for valid API key', async () => {
    const { key, hash } = generateApiKey()

    db.insert(mailboxes).values({
      id: 'mb-1',
      orgId: 'org-1',
      domainId: 'dom-1',
      localPart: 'agent',
      address: 'agent@test.com',
      apiKeyHash: hash,
      softCapBytes: 30 * 1024 * 1024,
      createdAt: new Date(),
    }).run()

    const event = createMockEvent('/api/v1/messages', `Bearer ${key}`)
    await handler(event)

    expect(event.context.mailbox).toBeDefined()
    expect(event.context.mailbox.id).toBe('mb-1')
    expect(event.context.mailbox.address).toBe('agent@test.com')
  })
})
