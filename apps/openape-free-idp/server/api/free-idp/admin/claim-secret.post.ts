import { defineEventHandler } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { adminClaimSecrets } from '../../../database/schema'
import {
  adminTxtName,
  clearAdminCache,
  extractEmailDomain,
  generateClaimSecret,
  hashSecret,
} from '../../../utils/admin-claim'
import { useRuntimeConfig } from 'nitropack/runtime'

/**
 * Mint (or rotate) the user's DNS-claim secret. The cleartext is
 * returned EXACTLY ONCE in this response — there is no read-back
 * endpoint. If the user loses it before pasting into DNS they have
 * to call this again, which generates a new one and invalidates the
 * previous (revokedAt set on all prior rows for this user).
 *
 * Self-only: no email param. Acting on behalf of someone else makes
 * no sense — the secret has to land in DNS the user controls.
 */
export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const issuer = useRuntimeConfig().openapeIdp.issuer as string
  const db = useDb()
  const now = Math.floor(Date.now() / 1000)
  const lowerEmail = email.toLowerCase()

  // Revoke any active secrets — previous TXT records become invalid.
  // We keep the rows for audit; only the active set is used at
  // verification time (via `isNull(revokedAt)`).
  await db
    .update(adminClaimSecrets)
    .set({ revokedAt: now })
    .where(and(
      eq(adminClaimSecrets.userEmail, lowerEmail),
      isNull(adminClaimSecrets.revokedAt),
    ))
    .run()

  const secret = generateClaimSecret()
  await db.insert(adminClaimSecrets).values({
    userEmail: lowerEmail,
    secretHash: hashSecret(secret),
    createdAt: now,
  }).run()

  // Bust any cached "isRoot=false" answer so the recheck endpoint
  // doesn't have to wait for negative TTL on first verification.
  clearAdminCache(email)

  const domain = extractEmailDomain(email)
  return {
    secret,
    txtName: domain ? adminTxtName(issuer, domain) : null,
    domain,
    createdAt: now,
  }
})
