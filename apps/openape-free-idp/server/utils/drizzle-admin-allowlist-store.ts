import type { AdminAllowlistStore } from '@openape/auth'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { adminAllowlist } from '../database/schema'

/**
 * Drizzle-backed AdminAllowlistStore for `mode=allowlist-admin`
 * (#307). One row per (userDomain, clientId) — managed via the
 * admin endpoints in /api/free-idp/admin/allowlist.
 */
export function createDrizzleAdminAllowlistStore(): AdminAllowlistStore {
  return {
    async isAllowed(userDomain: string, clientId: string): Promise<boolean> {
      const row = await useDb()
        .select({ clientId: adminAllowlist.clientId })
        .from(adminAllowlist)
        .where(and(
          eq(adminAllowlist.domain, userDomain.toLowerCase()),
          eq(adminAllowlist.clientId, clientId.toLowerCase()),
        ))
        .get()
      return !!row
    },
  }
}
