import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

/**
 * One-time migration: sync the denormalized grant_type column with
 * the grant_type inside the request JSON for all approved grants.
 * Fixes grants where updateStatus() did not persist the modified request.
 * Safe to remove after first successful deploy.
 */
export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  const db = useDb()
  const result = await db.run(sql`
    UPDATE grants
    SET grant_type = json_extract(request, '$.grant_type')
    WHERE status = 'approved'
      AND grant_type != json_extract(request, '$.grant_type')
  `)

  if (result.rowsAffected > 0) {
    console.log(`[fix-grant-types] Fixed ${result.rowsAffected} grant(s) with mismatched grant_type`)
  }
})
