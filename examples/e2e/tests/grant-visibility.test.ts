import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapTestUser, bootstrapTestUserSshKey } from '../helpers/bootstrap.js'
import { IDP_URL, IS_PROD, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY, TEST_USER } from '../helpers/constants.js'
import { loginWithSshKey } from '../helpers/key-auth.js'
import { startServers, stopServers } from '../helpers/server-manager.js'

describe('grant Lifecycle & Dashboard Visibility', () => {
  beforeAll(async () => {
    await startServers()
    await bootstrapTestUser(TEST_USER)
    await bootstrapTestUserSshKey(TEST_USER.email, TEST_SSH_PUBLIC_KEY)
  })

  afterAll(async () => {
    await stopServers()
  })

  /** POST JSON with Bearer auth to IdP. */
  async function idpPost<T = unknown>(jwt: string, path: string, body: unknown): Promise<{ status: number, data: T }> {
    const res = await fetch(`${IDP_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
    })
    const data = await res.json() as T
    return { status: res.status, data }
  }

  /** GET JSON with Bearer auth from IdP. */
  async function idpGet<T = unknown>(jwt: string, path: string): Promise<{ status: number, data: T }> {
    const res = await fetch(`${IDP_URL}${path}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const data = await res.json() as T
    return { status: res.status, data }
  }

  async function createGrant(jwt: string, grantType: 'once' | 'timed' | 'always' = 'once') {
    const { status, data } = await idpPost<{ id: string, status: string }>(jwt, '/api/grants', {
      requester: TEST_USER.email,
      target_host: 'test-sp',
      audience: 'escapes',
      grant_type: grantType,
      permissions: ['read'],
    })
    expect(status).toBe(200)
    expect(data.id).toBeTruthy()
    expect(data.status).toBe('pending')
    return data
  }

  it('shows grants the user requested in the dashboard', async () => {
    const jwt = await loginWithSshKey(IDP_URL, TEST_USER.email, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY)

    // Create a pending grant
    const grant1 = await createGrant(jwt)

    // Dashboard should show the pending grant
    const { data: grants1 } = await idpGet<{ id: string, status: string }[]>(jwt, '/api/grants')
    expect(grants1.some(g => g.id === grant1.id && g.status === 'pending')).toBe(true)

    // Approve the grant
    const { status: approveStatus, data: approveData } = await idpPost<{
      grant: { id: string, status: string }
      authz_jwt: string
    }>(jwt, `/api/grants/${grant1.id}/approve`, {})
    expect(approveStatus).toBe(200)
    expect(approveData.grant.status).toBe('approved')

    // Allow S3 eventual consistency in prod
    if (IS_PROD) await new Promise(r => setTimeout(r, 1000))

    // Dashboard should show the approved grant
    const { data: grants2 } = await idpGet<{ id: string, status: string }[]>(jwt, '/api/grants')
    expect(grants2.some(g => g.id === grant1.id && g.status === 'approved')).toBe(true)

    // Create a second grant and deny it
    const grant2 = await createGrant(jwt)
    const { status: denyStatus } = await idpPost(jwt, `/api/grants/${grant2.id}/deny`, {})
    expect(denyStatus).toBe(200)

    // Dashboard should show both grants
    const { data: grants3 } = await idpGet<{ id: string, status: string }[]>(jwt, '/api/grants')
    expect(grants3.some(g => g.id === grant1.id)).toBe(true)
    expect(grants3.some(g => g.id === grant2.id && g.status === 'denied')).toBe(true)
  })

  it('verifies AuthZ-JWT and invalidates once-grants', async () => {
    const jwt = await loginWithSshKey(IDP_URL, TEST_USER.email, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY)

    // Create and approve a once-grant
    const grant = await createGrant(jwt, 'once')
    const { data: approveData } = await idpPost<{
      grant: { id: string, status: string }
      authz_jwt: string
    }>(jwt, `/api/grants/${grant.id}/approve`, {})
    expect(approveData.authz_jwt).toBeTruthy()

    const token = approveData.authz_jwt

    // First verify: should succeed and consume the grant
    const { status: v1Status, data: v1 } = await idpPost<{
      valid: boolean
      claims?: Record<string, unknown>
      grant?: { status: string }
      error?: string
    }>(jwt, '/api/grants/verify', { token })

    expect(v1Status).toBe(200)
    expect(v1.valid).toBe(true)
    expect(v1.claims).toBeTruthy()
    expect(v1.grant?.status).toBe('used')

    // Second verify: should fail (once-grant already used)
    const { status: v2Status, data: v2 } = await idpPost<{
      valid: boolean
      error?: string
    }>(jwt, '/api/grants/verify', { token })

    expect(v2Status).toBe(200)
    expect(v2.valid).toBe(false)
    expect(v2.error).toContain('not approved')
  })
})
