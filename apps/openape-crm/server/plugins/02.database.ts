import { sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../database/drizzle'
import { planDealMigration } from '#shared/pipelines'

export default defineNitroPlugin(async () => {
  const db = useDb()

  await db.run(sql`CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    archived_at INTEGER
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_email)
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_wm_email ON workspace_members(user_email)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS workspace_invites (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    note TEXT,
    grant_role TEXT NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 5,
    used_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_wi_workspace ON workspace_invites(workspace_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    domain TEXT,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_org_workspace ON organizations(workspace_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    org_id TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_contact_workspace ON contacts(workspace_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    value_cents INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL,
    contact_id TEXT,
    org_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_deal_workspace ON deals(workspace_id)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_deal_stage ON deals(workspace_id, stage, position)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    author_email TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_note_deal ON notes(deal_id, created_at)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS contact_emails (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    email TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_contact_emails ON contact_emails(contact_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS contact_phones (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_contact_phones ON contact_phones(contact_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS deal_contacts (
    deal_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (deal_id, contact_id)
  )`)

  for (const stmt of [
    sql`ALTER TABLE organizations ADD COLUMN website TEXT`,
    sql`ALTER TABLE organizations ADD COLUMN address TEXT`,
    sql`ALTER TABLE organizations ADD COLUMN postal_code TEXT`,
    sql`ALTER TABLE organizations ADD COLUMN city TEXT`,
    sql`ALTER TABLE organizations ADD COLUMN country TEXT`,
    sql`ALTER TABLE contacts ADD COLUMN first_name TEXT`,
    sql`ALTER TABLE contacts ADD COLUMN last_name TEXT`,
    sql`ALTER TABLE contacts ADD COLUMN title TEXT`,
    sql`ALTER TABLE contacts ADD COLUMN gender TEXT`,
    sql`ALTER TABLE deals ADD COLUMN phase TEXT NOT NULL DEFAULT 'deal'`,
    sql`ALTER TABLE deals ADD COLUMN stufe TEXT NOT NULL DEFAULT 'inbound'`,
    sql`ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'notiz'`,
    sql`ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT 'Notiz'`,
  ]) {
    try { await db.run(stmt) }
    catch { /* column already exists */ }
  }

  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_deal_stufe ON deals(workspace_id, phase, stufe, position)`)

  const stagesTable = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='pipeline_stages'`)
  if (stagesTable.rows.length > 0) {
    const rows = await db.run(sql`
      SELECT d.id AS id, COALESCE(p.outcome, 'open') AS outcome
      FROM deals d
      LEFT JOIN pipeline_stages p ON p.workspace_id = d.workspace_id AND p.key = d.stage
    `)
    const patches = planDealMigration(rows.rows.map(r => ({
      id: String(r.id),
      outcome: r.outcome === 'won' || r.outcome === 'lost' ? r.outcome : 'open',
    })))
    for (const patch of patches) {
      await db.run(sql`UPDATE deals SET phase = ${patch.phase}, stufe = ${patch.stufe}, stage = ${patch.stufe} WHERE id = ${patch.id}`)
    }
    await db.run(sql`DROP TABLE IF EXISTS pipeline_stages`)
  }

  await db.run(sql`
    INSERT INTO deal_contacts (deal_id, contact_id)
    SELECT id, contact_id FROM deals
    WHERE contact_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = deals.id AND dc.contact_id = deals.contact_id)
  `)

  const emails = await db.run(sql`
    SELECT id, email FROM contacts
    WHERE email IS NOT NULL AND email != ''
      AND NOT EXISTS (SELECT 1 FROM contact_emails e WHERE e.contact_id = contacts.id)
  `)
  for (const row of emails.rows) {
    await db.run(sql`INSERT INTO contact_emails (id, contact_id, email, position) VALUES (${ulid()}, ${String(row.id)}, ${String(row.email)}, 0)`)
  }

  const phones = await db.run(sql`
    SELECT id, phone FROM contacts
    WHERE phone IS NOT NULL AND phone != ''
      AND NOT EXISTS (SELECT 1 FROM contact_phones p WHERE p.contact_id = contacts.id)
  `)
  for (const row of phones.rows) {
    await db.run(sql`INSERT INTO contact_phones (id, contact_id, phone, position) VALUES (${ulid()}, ${String(row.id)}, ${String(row.phone)}, 0)`)
  }

  await db.run(sql`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    standard_price_cents INTEGER NOT NULL DEFAULT 0,
    standard_billing TEXT NOT NULL DEFAULT 'monatlich',
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_product_workspace ON products(workspace_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offen',
    start_date TEXT NOT NULL,
    minimum_term_months INTEGER,
    currency TEXT NOT NULL DEFAULT 'EUR',
    offer_number TEXT NOT NULL,
    conditions TEXT,
    drive_item_id TEXT,
    web_url TEXT,
    signed_drive_item_id TEXT,
    signed_web_url TEXT,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_contract_deal ON contracts(deal_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS contract_lines (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    discount_cents INTEGER NOT NULL DEFAULT 0,
    billing TEXT NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_line_contract ON contract_lines(contract_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS deal_files (
    id TEXT PRIMARY KEY,
    deal_id TEXT NOT NULL,
    contract_id TEXT,
    name TEXT NOT NULL,
    drive_item_id TEXT NOT NULL,
    web_url TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_file_deal ON deal_files(deal_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_at TEXT,
    assignee_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offen',
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_task_deal ON tasks(deal_id)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_task_workspace ON tasks(workspace_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    deal_id TEXT,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'neu',
    source TEXT NOT NULL,
    internet_message_id TEXT,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_thread_workspace ON threads(workspace_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS thread_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    from_address TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_msg_thread ON thread_messages(thread_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS graph_accounts (
    user_email TEXT PRIMARY KEY,
    graph_user_id TEXT,
    mail TEXT,
    encrypted_refresh TEXT NOT NULL,
    subscription_id TEXT,
    subscription_expires INTEGER,
    connected_at INTEGER NOT NULL
  )`)
})
