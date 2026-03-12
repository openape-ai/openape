import { describe, expect, it, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import * as schema from '../../server/database/schema'

const { organizations, domains, mailboxes, messages } = schema

// Create in-memory DB for tests
function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })

  sqlite.exec(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      openape_subject TEXT NOT NULL,
      max_mailboxes INTEGER DEFAULT 5,
      mailbox_size_mb INTEGER DEFAULT 30,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE domains (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      domain TEXT NOT NULL UNIQUE,
      resend_domain_id TEXT,
      status TEXT DEFAULT 'pending',
      dns_records TEXT,
      created_at INTEGER NOT NULL
    );
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
    CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL,
      mailbox_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      subject TEXT,
      text_body TEXT,
      html_body TEXT,
      size_bytes INTEGER NOT NULL,
      resend_email_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_messages_mailbox_created ON messages(mailbox_id, created_at);
  `)

  return db
}

let db: ReturnType<typeof createTestDb>

// Mock useDb to return our test DB
vi.mock('../../server/utils/db', () => ({
  useDb: () => db,
}))

// Import after mock is set up
const { updateQuota, reduceQuota, enforceQuota } = await import('../../server/utils/quota')

function seedTestData(softCapBytes = 1000) {
  db.insert(organizations).values({
    id: 'org-1',
    name: 'Test Org',
    openapeSubject: 'test@example.com',
    createdAt: new Date(),
  }).run()

  db.insert(domains).values({
    id: 'dom-1',
    orgId: 'org-1',
    domain: 'test.example.com',
    status: 'verified',
    createdAt: new Date(),
  }).run()

  db.insert(mailboxes).values({
    id: 'mb-1',
    orgId: 'org-1',
    domainId: 'dom-1',
    localPart: 'agent',
    address: 'agent@test.example.com',
    apiKeyHash: 'fakehash',
    softCapBytes,
    createdAt: new Date(),
  }).run()
}

function insertMessage(id: string, sizeBytes: number, createdAtMs: number) {
  db.insert(messages).values({
    id,
    mailboxId: 'mb-1',
    direction: 'inbound',
    fromAddr: 'sender@ext.com',
    toAddr: 'agent@test.example.com',
    subject: `Message ${id}`,
    sizeBytes,
    createdAt: new Date(createdAtMs),
  }).run()
}

function getMailbox() {
  return db.select().from(mailboxes).where(eq(mailboxes.id, 'mb-1')).get()!
}

function getMessageIds() {
  return db.select({ id: messages.id }).from(messages).where(eq(messages.mailboxId, 'mb-1')).all().map(m => m.id)
}

describe('quota', () => {
  beforeEach(() => {
    db = createTestDb()
  })

  describe('updateQuota', () => {
    it('increments totalSizeBytes and messageCount', async () => {
      seedTestData()
      await updateQuota('mb-1', 500)
      const mb = getMailbox()
      expect(mb.totalSizeBytes).toBe(500)
      expect(mb.messageCount).toBe(1)
    })

    it('accumulates multiple updates', async () => {
      seedTestData()
      await updateQuota('mb-1', 200)
      await updateQuota('mb-1', 300)
      const mb = getMailbox()
      expect(mb.totalSizeBytes).toBe(500)
      expect(mb.messageCount).toBe(2)
    })
  })

  describe('reduceQuota', () => {
    it('decrements totalSizeBytes and messageCount', async () => {
      seedTestData()
      await updateQuota('mb-1', 500)
      await updateQuota('mb-1', 300)
      await reduceQuota('mb-1', 300)
      const mb = getMailbox()
      expect(mb.totalSizeBytes).toBe(500)
      expect(mb.messageCount).toBe(1)
    })

    it('does not go below zero', async () => {
      seedTestData()
      await reduceQuota('mb-1', 999)
      const mb = getMailbox()
      expect(mb.totalSizeBytes).toBe(0)
      expect(mb.messageCount).toBe(0)
    })
  })

  describe('enforceQuota', () => {
    it('does nothing when under cap', async () => {
      seedTestData(1000)
      insertMessage('msg-1', 400, 1000)
      insertMessage('msg-2', 400, 2000)
      await updateQuota('mb-1', 400)
      await updateQuota('mb-1', 400)

      await enforceQuota('mb-1')

      expect(getMessageIds()).toEqual(['msg-1', 'msg-2'])
    })

    it('deletes oldest messages when over cap', async () => {
      seedTestData(500)
      insertMessage('msg-1', 200, 1000)
      insertMessage('msg-2', 200, 2000)
      insertMessage('msg-3', 200, 3000)

      // Manually set totalSizeBytes to 600 (over 500 cap)
      db.update(mailboxes).set({ totalSizeBytes: 600, messageCount: 3 }).where(eq(mailboxes.id, 'mb-1')).run()

      await enforceQuota('mb-1')

      // Should delete msg-1 (oldest, 200 bytes) to get from 600 to 400 (<= 500)
      const remaining = getMessageIds()
      expect(remaining).not.toContain('msg-1')
      expect(remaining).toContain('msg-2')
      expect(remaining).toContain('msg-3')

      const mb = getMailbox()
      expect(mb.totalSizeBytes).toBe(400)
      expect(mb.messageCount).toBe(2)
    })

    it('deletes multiple oldest messages if needed', async () => {
      seedTestData(300)
      insertMessage('msg-1', 200, 1000)
      insertMessage('msg-2', 200, 2000)
      insertMessage('msg-3', 200, 3000)
      insertMessage('msg-4', 200, 4000)

      db.update(mailboxes).set({ totalSizeBytes: 800, messageCount: 4 }).where(eq(mailboxes.id, 'mb-1')).run()

      await enforceQuota('mb-1')

      // Need to delete msg-1, msg-2, msg-3 (600 bytes) to go from 800 to 200 (<= 300)
      const remaining = getMessageIds()
      expect(remaining).toEqual(['msg-4'])

      const mb = getMailbox()
      expect(mb.totalSizeBytes).toBe(200)
      expect(mb.messageCount).toBe(1)
    })

    it('handles non-existent mailbox gracefully', async () => {
      seedTestData()
      await enforceQuota('non-existent')
      // Should not throw
    })
  })
})
