import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapTestUser, bootstrapTestUserSshKey } from '../helpers/bootstrap.js'
import { IDP_URL, SP_URL, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY, TEST_USER } from '../helpers/constants.js'
import { HttpClient } from '../helpers/http-client.js'
import { loginWithSshKey } from '../helpers/key-auth.js'
import { startServers, stopServers } from '../helpers/server-manager.js'

const TEST_EMAIL = TEST_USER.email

describe('once-Grant Re-request Flow', () => {
  beforeAll(async () => {
    await startServers()
    await bootstrapTestUser(TEST_USER)
    await bootstrapTestUserSshKey(TEST_USER.email, TEST_SSH_PUBLIC_KEY)
  })

  afterAll(async () => {
    await stopServers()
  })

  /** Login to SP via the OIDC redirect chain using SSH key auth. */
  async function loginToSP(client: HttpClient) {
    // Step 1: SP login — get authorization URL
    const { status, data: loginData } = await client.postJSON<{ redirectUrl: string }>(
      `${SP_URL}/api/login`,
      { email: TEST_EMAIL },
    )
    expect(status).toBe(200)

    // Step 2: Get JWT via SSH key challenge-response auth
    const jwt = await loginWithSshKey(IDP_URL, TEST_EMAIL, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY)

    // Step 3: Hit /authorize with Bearer token — should issue code directly
    const step3 = await client.fetch(loginData.redirectUrl, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    expect(step3.status).toBe(302)
    const callbackUrl = step3.headers.get('Location')!
    expect(callbackUrl).toContain(`${SP_URL}/api/callback`)

    // Step 4: Follow SP callback — sets session, redirects to /dashboard
    const step4 = await client.fetch(callbackUrl)
    expect(step4.headers.get('Location')).toBe('/dashboard')

    return jwt
  }

  /** Request permission on SP, approve on IdP, follow callback back to SP. */
  async function requestAndApproveGrant(client: HttpClient, jwt: string) {
    // Request permission on SP — creates grant on IdP
    const { status: permStatus, data: permData } = await client.postJSON<{
      redirectUrl: string
      grantId: string
    }>(`${SP_URL}/api/request-permission`, {
      action: 'protected-action',
      reason: 'Test grant',
    })
    expect(permStatus).toBe(200)

    const grantId = permData.grantId

    // Approve the grant on IdP (using Bearer token)
    const approveRes = await fetch(`${IDP_URL}/api/grants/${grantId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({}),
    })
    expect(approveRes.status).toBe(200)

    const approveData = await approveRes.json() as {
      grant: { status: string }
      authz_jwt: string
    }
    expect(approveData.authz_jwt).toBeTruthy()

    // Extract the callback base URL from the approval redirect URL
    const approvalUrl = new URL(permData.redirectUrl)
    const callbackBase = approvalUrl.searchParams.get('callback')!

    // Simulate the IdP redirect to SP grant-callback with the approval
    const callbackUrl = `${callbackBase}?grant_id=${grantId}&authz_jwt=${encodeURIComponent(approveData.authz_jwt)}&status=approved`
    const cbRes = await client.fetch(callbackUrl)
    expect(cbRes.status).toBe(302)
    expect(cbRes.headers.get('Location')).toBe('/dashboard?grant_status=approved')
  }

  it('can request and use a once-grant, then request and use another', async () => {
    const client = new HttpClient()

    // Login to SP via full OIDC flow with SSH key auth
    const jwt = await loginToSP(client)

    // Verify we're authenticated
    const { status: meStatus } = await client.getJSON(`${SP_URL}/api/me`)
    expect(meStatus).toBe(200)

    // --- First grant cycle ---
    await requestAndApproveGrant(client, jwt)

    // Verify session has authz_jwt
    const { data: status1 } = await client.getJSON<{ hasAuthzJWT: boolean }>(
      `${SP_URL}/api/grant-status`,
    )
    expect(status1.hasAuthzJWT).toBe(true)

    // Execute protected action — should succeed and consume once-grant
    const { status: execStatus1, data: execData1 } = await client.postJSON<{
      success: boolean
      grantConsumed: boolean
    }>(`${SP_URL}/api/protected-action`, {})
    expect(execStatus1).toBe(200)
    expect(execData1.success).toBe(true)
    expect(execData1.grantConsumed).toBe(true)

    // Verify session cleared after consumption
    const { data: status2 } = await client.getJSON<{ hasAuthzJWT: boolean }>(
      `${SP_URL}/api/grant-status`,
    )
    expect(status2.hasAuthzJWT).toBe(false)

    // --- Second grant cycle ---
    await requestAndApproveGrant(client, jwt)

    // Verify session has new authz_jwt
    const { data: status3 } = await client.getJSON<{ hasAuthzJWT: boolean }>(
      `${SP_URL}/api/grant-status`,
    )
    expect(status3.hasAuthzJWT).toBe(true)

    // Execute protected action again — should succeed
    const { status: execStatus2, data: execData2 } = await client.postJSON<{
      success: boolean
      grantConsumed: boolean
    }>(`${SP_URL}/api/protected-action`, {})
    expect(execStatus2).toBe(200)
    expect(execData2.success).toBe(true)
    expect(execData2.grantConsumed).toBe(true)
  })
})
