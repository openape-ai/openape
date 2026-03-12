import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapTestUser } from '../helpers/bootstrap.js'
import { IDP_URL, SP_URL, TEST_USER } from '../helpers/constants.js'
import { HttpClient } from '../helpers/http-client.js'
import { startServers, stopServers } from '../helpers/server-manager.js'

const TEST_EMAIL = TEST_USER.email
const TEST_PASSWORD = TEST_USER.password

describe('once-Grant Re-request Flow', () => {
  beforeAll(async () => {
    await startServers()
    await bootstrapTestUser(TEST_USER)
  })

  afterAll(async () => {
    await stopServers()
  })

  /** Login to SP via the full OIDC redirect chain (same pattern as login-flow.test.ts). */
  async function loginToSP(client: HttpClient) {
    // Step 1: SP login — get authorization URL
    const { status, data: loginData } = await client.postJSON<{ redirectUrl: string }>(
      `${SP_URL}/api/login`,
      { email: TEST_EMAIL },
    )
    expect(status).toBe(200)

    // Step 2: Follow IdP /authorize — not authenticated, redirects to /login
    await client.fetch(loginData.redirectUrl)

    // Step 3: Authenticate on IdP
    const { status: idpLoginStatus } = await client.postJSON(`${IDP_URL}/api/login`, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })
    expect(idpLoginStatus).toBe(200)

    // Step 4: Hit /authorize again — now authenticated, redirects to SP callback
    const step4 = await client.fetch(loginData.redirectUrl)
    const callbackUrl = step4.headers.get('Location')!
    expect(callbackUrl).toContain(`${SP_URL}/api/callback`)

    // Step 5: Follow SP callback — sets session, redirects to /dashboard
    const step5 = await client.fetch(callbackUrl)
    expect(step5.headers.get('Location')).toBe('/dashboard')
  }

  /** Request permission on SP, approve on IdP, follow callback back to SP. */
  async function requestAndApproveGrant(client: HttpClient) {
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

    // Approve the grant on IdP (user is already authenticated there)
    const { status: approveStatus, data: approveData } = await client.postJSON<{
      grant: { status: string }
      authzJWT: string
    }>(`${IDP_URL}/api/grants/${grantId}/approve`, {})
    expect(approveStatus).toBe(200)
    expect(approveData.authzJWT).toBeTruthy()

    // Extract the callback base URL from the approval redirect URL
    const approvalUrl = new URL(permData.redirectUrl)
    const callbackBase = approvalUrl.searchParams.get('callback')!

    // Simulate the IdP redirect to SP grant-callback with the approval
    const callbackUrl = `${callbackBase}?grant_id=${grantId}&authz_jwt=${encodeURIComponent(approveData.authzJWT)}&status=approved`
    const cbRes = await client.fetch(callbackUrl)
    expect(cbRes.status).toBe(302)
    expect(cbRes.headers.get('Location')).toBe('/dashboard?grant_status=approved')
  }

  it('can request and use a once-grant, then request and use another', async () => {
    const client = new HttpClient()

    // Login to SP via full OIDC flow
    await loginToSP(client)

    // Verify we're authenticated
    const { status: meStatus } = await client.getJSON(`${SP_URL}/api/me`)
    expect(meStatus).toBe(200)

    // --- First grant cycle ---
    await requestAndApproveGrant(client)

    // Verify session has authzJWT
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
    await requestAndApproveGrant(client)

    // Verify session has new authzJWT
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
