import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'

const url = process.env.TURSO_URL
const authToken = process.env.TURSO_AUTH_TOKEN
const client = createClient({ url, authToken })

// Check if shapes table exists
const exists = await client.execute('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'shapes\'')
if (exists.rows.length > 0) {
  console.log('shapes table already exists, skipping')
}
else {
  const sql = readFileSync('./server/database/migrations/0001_shapes_and_standing_grants.sql', 'utf-8')
  const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)
  for (const stmt of statements) {
    console.log('Executing:', stmt.slice(0, 80))
    await client.execute(stmt)
  }
  console.log('Migration applied.')
}
