/** When E2E_IDP_URL is set, tests run against deployed (prod) servers. */
export const IS_PROD = !!process.env.E2E_IDP_URL

export const IDP_PORT = 3000
export const SP_PORT = 3001

export const IDP_URL = process.env.E2E_IDP_URL || `http://localhost:${IDP_PORT}`
export const SP_URL = process.env.E2E_SP_URL || `http://localhost:${SP_PORT}`

export const MANAGEMENT_TOKEN = process.env.E2E_MANAGEMENT_TOKEN || 'test-mgmt-token'

export const SP_ID = process.env.E2E_SP_ID || 'sp.example.com'

/** Test user — domain must match the DDISA DNS record for the target environment. */
export const TEST_USER = {
  email: process.env.E2E_TEST_EMAIL || 'admin@example.com',
  password: process.env.E2E_TEST_PASSWORD || 'q1w2e3r4',
  name: 'E2E Test User',
}
