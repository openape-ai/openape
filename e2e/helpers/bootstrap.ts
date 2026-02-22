import { IDP_URL } from './constants.js'
import { HttpClient } from './http-client.js'

const SUPER_ADMIN_PASSWORD = 'test-super-admin'

/**
 * Bootstrap a test user via super-admin login + admin API.
 * Logs in with the super-admin password, creates the user, then logs out.
 */
export async function bootstrapTestUser(
  opts: { email: string, password: string, name: string },
): Promise<void> {
  const client = new HttpClient()

  // Login as super-admin
  const { status: loginStatus } = await client.postJSON(`${IDP_URL}/api/login`, {
    email: opts.email,
    password: SUPER_ADMIN_PASSWORD,
  })
  if (loginStatus !== 200) {
    throw new Error(`Super-admin login failed with status ${loginStatus}`)
  }

  // Create the test user
  const { status: createStatus } = await client.postJSON(`${IDP_URL}/api/admin/users`, {
    email: opts.email,
    password: opts.password,
    name: opts.name,
  })
  if (createStatus !== 200 && createStatus !== 409) {
    throw new Error(`User creation failed with status ${createStatus}`)
  }

  // Logout
  await client.postJSON(`${IDP_URL}/api/logout`, {})
}
