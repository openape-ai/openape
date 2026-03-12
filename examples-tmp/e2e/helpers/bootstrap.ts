import { IDP_URL, MANAGEMENT_TOKEN } from './constants.js'

/**
 * Bootstrap a test user via management API token.
 * No session/login needed — uses Bearer token auth.
 */
export async function bootstrapTestUser(
  opts: { email: string, password: string, name: string },
): Promise<void> {
  const res = await fetch(`${IDP_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MANAGEMENT_TOKEN}`,
    },
    body: JSON.stringify(opts),
  })

  if (res.status !== 200 && res.status !== 409) {
    const body = await res.text().catch(() => '')
    throw new Error(`User creation failed (${res.status}): ${body}`)
  }
}
