import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { describe, expect, it } from 'vitest'
import { applyVaultSchema } from '../server/database/vault-tables'

// The startup plugin applies the schema through drizzle on every start. A
// restart must find the added columns already present and carry on, or every
// later column migration would silently never run.
describe('vault schema', () => {
  it('can be applied again on restart, through drizzle as at startup', async () => {
    const db = drizzle(createClient({ url: ':memory:' }))
    const run = (statement: string) => db.run(sql.raw(statement))
    await applyVaultSchema(run)
    await expect(applyVaultSchema(run)).resolves.toBeUndefined()
  })
})
