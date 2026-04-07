import { runIdPTestSuite } from '../src/index'

const BASE_URL = process.env.FREE_IDP_URL || 'https://id.openape.at'
const MGMT_TOKEN = process.env.FREE_IDP_MGMT_TOKEN

if (!MGMT_TOKEN) {
  console.warn('Skipping Free-IdP tests: set FREE_IDP_MGMT_TOKEN env var')
}
else {
  runIdPTestSuite({
    baseUrl: BASE_URL,
    managementToken: MGMT_TOKEN,
    skip: ['webauthn', 'federation'],
  })
}
