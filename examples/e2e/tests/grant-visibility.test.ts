import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapTestUser } from '../helpers/bootstrap.js'
import { IDP_URL, IS_PROD, TEST_USER } from '../helpers/constants.js'
import { HttpClient } from '../helpers/http-client.js'
import { startServers, stopServers } from '../helpers/server-manager.js'

describe('grant Lifecycle & Dashboard Visibility', () => {
  beforeAll(async () => {
    await startServers()
    await bootstrapTestUser(TEST_USER)
  })

  afterAll(async () => {
    await stopServers()
  })

  async function loginAsSeededUser(client: HttpClient) {
    const { status, data } = await client.postJSON<{ ok: boolean }>(
      `${IDP_URL}/api/login`,
      { email: TEST_USER.email, password: TEST_USER.password },
    )
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
  }

  async function createGrant(client: HttpClient, grantType: 'once' | 'timed' | 'always' = 'once') {
    const { status, data } = await client.postJSON<{ id: string, status: string }>(
      `${IDP_URL}/api/grants`,
      {
        requester: TEST_USER.email,
        target_host: 'test-sp',
        audience: 'escapes',
        grant_type: grantType,
        permissions: ['read'],
      },
    )
    expect(status).toBe(200)
    expect(data.id).toBeTruthy()
    expect(data.status).toBe('pending')
    return data
  }

  it('shows grants the user requested in the dashboard', async () => {
    const client = new HttpClient()
    await loginAsSeededUser(client)

    // Create a pending grant
    const grant1 = await createGrant(client)

    // Dashboard should show the pending grant
    const { data: grants1 } = await client.getJSON<{ id: string, status: string }[]>(
      `${IDP_URL}/api/grants`,
    )
    expect(grants1.some(g => g.id === grant1.id && g.status === 'pending')).toBe(true)

    // Approve the grant
    const { status: approveStatus, data: approveData } = await client.postJSON<{
      grant: { id: string, status: string }
      authz_jwt: string
    }>(`${IDP_URL}/api/grants/${grant1.id}/approve`, {})
    expect(approveStatus).toBe(200)
    expect(approveData.grant.status).toBe('approved')

    // Allow S3 eventual consistency in prod
    if (IS_PROD) await new Promise(r => setTimeout(r, 1000))

    // Dashboard should show the approved grant
    const { data: grants2 } = await client.getJSON<{ id: string, status: string }[]>(
      `${IDP_URL}/api/grants`,
    )
    expect(grants2.some(g => g.id === grant1.id && g.status === 'approved')).toBe(true)

    // Create a second grant and deny it
    const grant2 = await createGrant(client)
    const { status: denyStatus } = await client.postJSON(
      `${IDP_URL}/api/grants/${grant2.id}/deny`,
      {},
    )
    expect(denyStatus).toBe(200)

    // Dashboard should show both grants
    const { data: grants3 } = await client.getJSON<{ id: string, status: string }[]>(
      `${IDP_URL}/api/grants`,
    )
    expect(grants3.some(g => g.id === grant1.id)).toBe(true)
    expect(grants3.some(g => g.id === grant2.id && g.status === 'denied')).toBe(true)
  })

  it('verifies AuthZ-JWT and invalidates once-grants', async () => {
    const client = new HttpClient()
    await loginAsSeededUser(client)

    // Create and approve a once-grant
    const grant = await createGrant(client, 'once')
    const { data: approveData } = await client.postJSON<{
      grant: { id: string, status: string }
      authz_jwt: string
    }>(`${IDP_URL}/api/grants/${grant.id}/approve`, {})
    expect(approveData.authz_jwt).toBeTruthy()

    const token = approveData.authz_jwt

    // First verify: should succeed and consume the grant
    const { status: v1Status, data: v1 } = await client.postJSON<{
      valid: boolean
      claims?: Record<string, unknown>
      grant?: { status: string }
      error?: string
    }>(`${IDP_URL}/api/grants/verify`, { token })

    expect(v1Status).toBe(200)
    expect(v1.valid).toBe(true)
    expect(v1.claims).toBeTruthy()
    expect(v1.grant?.status).toBe('used')

    // Second verify: should fail (once-grant already used)
    const { status: v2Status, data: v2 } = await client.postJSON<{
      valid: boolean
      error?: string
    }>(`${IDP_URL}/api/grants/verify`, { token })

    expect(v2Status).toBe(200)
    expect(v2.valid).toBe(false)
    expect(v2.error).toContain('not approved')
  })
})
