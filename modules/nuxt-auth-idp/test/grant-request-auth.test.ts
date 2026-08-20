import { afterEach, describe, expect, it, vi } from 'vitest'

let runtimeConfig: Record<string, unknown> = {}
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => runtimeConfig,
}))

const { allowUnauthenticatedGrantRequests } = await import('../src/runtime/server/utils/grant-request-auth')

describe('allowUnauthenticatedGrantRequests', () => {
  afterEach(() => {
    delete process.env.NUXT_OPENAPE_IDP_ALLOW_UNAUTH_GRANT_REQUESTS
    runtimeConfig = {}
  })

  it('defaults to enforcing authentication', () => {
    expect(allowUnauthenticatedGrantRequests()).toBe(false)
  })

  it('honors the module option', () => {
    runtimeConfig = { openapeIdp: { allowUnauthenticatedGrantRequests: true } }
    expect(allowUnauthenticatedGrantRequests()).toBe(true)
  })

  it('treats a non-boolean config value as off', () => {
    runtimeConfig = { openapeIdp: { allowUnauthenticatedGrantRequests: 'yes' } }
    expect(allowUnauthenticatedGrantRequests()).toBe(false)
  })

  it('honors the env escape hatch', () => {
    process.env.NUXT_OPENAPE_IDP_ALLOW_UNAUTH_GRANT_REQUESTS = '1'
    expect(allowUnauthenticatedGrantRequests()).toBe(true)
  })
})
