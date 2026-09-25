import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { createDrizzleBrokerStore } from '../utils/drizzle-broker-store'

export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return
  const db = useDb()
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(grants)`)
  if (!columns.some(column => column.name === 'brokered')) await db.run(sql`ALTER TABLE grants ADD COLUMN brokered TEXT`)
  if (!columns.some(column => column.name === 'broker_owner')) await db.run(sql`ALTER TABLE grants ADD COLUMN broker_owner TEXT`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_broker_owner ON grants(broker_owner)`)
  await db.run(sql`CREATE TABLE IF NOT EXISTS broker_connections (id TEXT PRIMARY KEY, owner TEXT NOT NULL, owner_issuer TEXT NOT NULL, broker_issuer TEXT NOT NULL, agent_domain TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_broker_connections_owner ON broker_connections(owner)`)
  await db.run(sql`CREATE TABLE IF NOT EXISTS broker_requests (connection_id TEXT NOT NULL, jti TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(connection_id, jti))`)
  await db.run(sql`CREATE TABLE IF NOT EXISTS broker_agents (subject TEXT PRIMARY KEY, key_id TEXT NOT NULL, owner TEXT NOT NULL, decision_issuer TEXT NOT NULL, connection_id TEXT NOT NULL)`)
  await db.run(sql`CREATE TABLE IF NOT EXISTS broker_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, grant_id TEXT NOT NULL, owner TEXT NOT NULL, agent TEXT NOT NULL, broker_issuer TEXT NOT NULL, connection_id TEXT NOT NULL, event TEXT NOT NULL, created_at INTEGER NOT NULL)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_broker_audit_grant ON broker_audit(grant_id)`)
  defineBrokerStore(() => createDrizzleBrokerStore())
})
