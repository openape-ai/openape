import { migrateLegacyGrantSummary } from '@openape/grants'
import { sql } from 'drizzle-orm'
import type { useDb } from '../database/drizzle'

type Database = Pick<ReturnType<typeof useDb>, 'transaction'>

/**
 * Converts every stored `request.summary.text` to the title/description form
 * of issue 1473 in one transaction. Idempotent: only rows that still carry
 * `text` are read, and none carries it afterwards. Returns the number of
 * converted grants.
 */
export async function migrateStoredGrantSummaries(db: Database): Promise<number> {
  return await db.transaction(async (tx) => {
    const rows = await tx.all<{ id: string, request: string }>(sql`SELECT id, request FROM grants WHERE CASE WHEN json_valid(request) THEN json_type(request, '$.summary.text') END IS NOT NULL`)
    for (const row of rows) {
      const request = JSON.parse(row.request) as { summary: { text: unknown, link?: unknown } } & Record<string, unknown>
      const { text, link } = request.summary
      const summary = typeof text === 'string' ? migrateLegacyGrantSummary({ text, link }) : undefined
      const { summary: _legacy, ...rest } = request
      await tx.run(sql`UPDATE grants SET request = ${JSON.stringify(summary ? { ...rest, summary } : rest)} WHERE id = ${row.id}`)
    }
    return rows.length
  })
}
