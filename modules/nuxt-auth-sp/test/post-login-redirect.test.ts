import { beforeEach, describe, expect, it, vi } from 'vitest'

// getSpConfig reads the SP options from the Nitro runtime config. Mock it so we
// can assert the resolved default without booting a Nuxt app.
const runtimeConfig: { openapeSp: Record<string, unknown> } = { openapeSp: {} }
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtimeConfig }))

const { getSpConfig } = await import('../src/runtime/server/utils/sp-config')
const { DEFAULT_POST_LOGIN_REDIRECT } = await import('../src/runtime/config-defaults')

describe('postLoginRedirect default', () => {
  beforeEach(() => {
    runtimeConfig.openapeSp = {}
  })

  it('is a universally-present route ("/"), not a page an SP may lack', () => {
    expect(DEFAULT_POST_LOGIN_REDIRECT).toBe('/')
  })

  it('falls back to "/" when the SP does not pin postLoginRedirect', () => {
    expect(getSpConfig().postLoginRedirect).toBe('/')
  })

  it('honours an explicit override', () => {
    runtimeConfig.openapeSp = { postLoginRedirect: '/dashboard' }
    expect(getSpConfig().postLoginRedirect).toBe('/dashboard')
  })
})
