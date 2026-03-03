import { sql } from 'drizzle-orm'
import { defineNitroPlugin } from 'nitropack/runtime'
import { useDb } from '../utils/db'

export default defineNitroPlugin(async () => {
  const db = useDb()

  await db.run(sql`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    openape_subject TEXT NOT NULL,
    max_mailboxes INTEGER DEFAULT 5,
    mailbox_size_mb INTEGER DEFAULT 30,
    created_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    domain TEXT NOT NULL UNIQUE,
    resend_domain_id TEXT,
    status TEXT DEFAULT 'pending',
    dns_records TEXT,
    created_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS mailboxes (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    domain_id TEXT NOT NULL REFERENCES domains(id),
    local_part TEXT NOT NULL,
    address TEXT NOT NULL UNIQUE,
    api_key_hash TEXT NOT NULL,
    total_size_bytes INTEGER DEFAULT 0,
    soft_cap_bytes INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
    direction TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    subject TEXT,
    text_body TEXT,
    html_body TEXT,
    size_bytes INTEGER NOT NULL,
    resend_email_id TEXT,
    created_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_created ON messages(mailbox_id, created_at)`)
})
