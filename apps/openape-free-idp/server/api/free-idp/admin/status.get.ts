import { defineEventHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../../../database/drizzle'
import {
  adminTxtName,
  extractEmailDomain,
  isOperator,
  isRootAdmin,
} from '../../../utils/admin-claim'

/**
 * "What admin powers do I have?" — used by the account page to
 * decide whether to render the Generate-Secret CTA, the SP-allowlist
 * UI, etc. Self-only — no leakage of other users' admin status.
 */
export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const issuer = useRuntimeConfig().openapeIdp.issuer as string
  const domain = extractEmailDomain(email)
  const db = useDb()

  const [root, operator] = await Promise.all([
    isRootAdmin(db, issuer, email),
    isOperator(db, email),
  ])

  return {
    email,
    domain,
    isRoot: root,
    isOperator: operator,
    // Hint for the UI when the user isn't yet root: where do they
    // need to put the TXT record?
    adminTxtName: domain ? adminTxtName(issuer, domain) : null,
  }
})
