import { createClient } from '@libsql/client'
import { expect, it } from 'vitest'
import { isDuplicateColumn } from '../server/utils/sqlite-errors'

it('tolerates only an existing column when a startup migration adds one', async () => {
  const client = createClient({ url: ':memory:' })
  await client.execute('CREATE TABLE shapes (cli_id TEXT PRIMARY KEY, tested_digests TEXT)')
  const duplicate = await client.execute('ALTER TABLE shapes ADD COLUMN tested_digests TEXT').catch((error: unknown) => error)
  const missingTable = await client.execute('ALTER TABLE missing ADD COLUMN tested_digests TEXT').catch((error: unknown) => error)
  client.close()
  expect(isDuplicateColumn(duplicate)).toBe(true)
  expect(isDuplicateColumn(missingTable)).toBe(false)
  expect(isDuplicateColumn('disk I/O error')).toBe(false)
})
