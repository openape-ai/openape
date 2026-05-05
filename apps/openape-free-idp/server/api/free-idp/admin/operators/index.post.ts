import { defineEventHandler, readBody } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { operators } from '../../../../database/schema'
import { clearAdminCache, extractEmailDomain } from '../../../../utils/admin-claim'

/**
 * Promote a user to operator for the caller's domain. Gated by
 * `requireRootAdmin` — only DNS-rooted root admins can extend the
 * admin tier; operators can't promote other operators (otherwise a
 * compromise of one operator account would let the attacker
 * persistently extend their access).
 *
 * The promoted user's email-domain is implicitly the caller's
 * domain — promoting a user from a different domain doesn't make
 * sense (operators only have power within their own tenant).
 */
export default defineEventHandler(async (event) => {
  const callerEmail = await requireRootAdmin(event)
  const domain = extractEmailDomain(callerEmail)
  if (!domain) {
    throw createProblemError({ status: 400, title: 'Caller has no email domain' })
  }

  const body = await readBody<{ email?: string }>(event)
  const email = String(body?.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    throw createProblemError({ status: 400, title: 'email is required' })
  }
  // Cross-domain promote would be confusing — an operator for
  // example.com couldn't actually do anything for deltamind.at
  // because all admin actions scope to the caller's domain. Reject.
  const targetDomain = extractEmailDomain(email)
  if (targetDomain !== domain) {
    throw createProblemError({
      status: 400,
      title: 'Operators must share the root admin\'s email domain',
    })
  }

  const now = Math.floor(Date.now() / 1000)
  await useDb()
    .insert(operators)
    .values({
      userEmail: email,
      domain,
      promotedBy: callerEmail.toLowerCase(),
      promotedAt: now,
    })
    .onConflictDoUpdate({
      target: [operators.userEmail, operators.domain],
      set: { promotedBy: callerEmail.toLowerCase(), promotedAt: now },
    })
    .run()

  // Bust the in-memory admin-status cache so the new operator picks
  // up their role on the next request without waiting for the 30s
  // negative TTL.
  clearAdminCache(email, domain)

  return { userEmail: email, domain, promotedBy: callerEmail, promotedAt: now }
})
