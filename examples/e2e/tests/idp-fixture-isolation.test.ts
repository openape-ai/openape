import { expect, it } from 'vitest'
import { startIdp } from '../helpers/idp-fixture.js'

// Parallel suites each boot an IdP from examples/idp. Its config is baked into
// the dev bundle, so a shared build dir let one IdP reload with another's
// management token (#610).
it('keeps the management token of each parallel IdP fixture', async () => {
  const tokens = ['isolation-token-a', 'isolation-token-b']
  const idps = await Promise.all(tokens.map(managementToken => startIdp({ managementToken })))
  try {
    // Give a reload triggered by the other build time to land.
    await new Promise(resolve => setTimeout(resolve, 5_000))
    const statuses = await Promise.all(idps.map(async (idp, i) =>
      (await fetch(`${idp.url}/api/admin/users`, { headers: { authorization: `Bearer ${tokens[i]}` } })).status))
    expect(statuses).toEqual([200, 200])
  }
  finally {
    await Promise.all(idps.map(idp => idp.stop()))
  }
})
