import { createError, defineEventHandler, getHeader, getRequestURL, readBody } from 'h3'
import { getAppSession } from '../utils/session'
import { validateCsrfToken, validateOrigin, enforceJsonContentType } from '../utils/csrf'
import { checkRateLimit } from '../utils/rate-limiter'
import { saveMagicLinkToken } from '../utils/magic-link-store'
import { sendMagicLinkEmail } from '../utils/email'

// eslint-disable-next-line no-control-regex
const EMAIL_RE = /^[^\s@\x00-\x1F]+@[^\s@\x00-\x1F]+\.[^\s@\x00-\x1F]+$/

export default defineEventHandler(async (event) => {
  // 1. Enforce JSON Content-Type
  enforceJsonContentType(event)

  // 2. Validate Origin
  validateOrigin(event)

  // 3. Session check: pendingAuthorize must exist
  const session = await getAppSession(event)
  if (!session.data.pendingAuthorize) {
    throw createError({ statusCode: 403, statusMessage: 'No pending authorization' })
  }

  // 4. CSRF token validation
  const body = await readBody<{ email: string, csrfToken: string }>(event)
  validateCsrfToken(session.data.csrfToken, body?.csrfToken)

  // 5. Email validation
  const email = body?.email?.trim()?.toLowerCase()
  if (!email || !EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  }

  // 6. Email must match login_hint from session
  if (session.data.loginHint && email !== session.data.loginHint.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: 'Email does not match' })
  }

  // 7. Rate limit check
  const ip = getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
    || getHeader(event, 'x-real-ip')
    || 'unknown'
  await checkRateLimit(email, ip)

  // 8. Generate token + send email
  const token = await saveMagicLinkToken(email)
  const baseUrl = getRequestURL(event).origin
  const verifyUrl = `${baseUrl}/api/verify?token=${token}`

  try {
    await sendMagicLinkEmail(email, verifyUrl)
    console.log('[magic-link] Email sent to', email)
  }
  catch (err) {
    console.error('[magic-link] Email send failed:', err)
  }

  // 9. Always same response (no user enumeration)
  return { ok: true }
})
