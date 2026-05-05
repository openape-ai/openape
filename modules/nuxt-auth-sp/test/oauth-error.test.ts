import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// `useOpenApeOAuthError` consumes Nuxt's `useRoute` + `useRouter`
// from `#imports`. We mock those so we can drive the route.query
// directly and assert behaviour without booting Nuxt.

const routeQuery = ref<Record<string, unknown>>({})
const routePath = ref('/')
const replaceCalls: Array<{ path: string, query: Record<string, unknown> }> = []

vi.mock('#imports', () => ({
  useRoute: () => ({ get query() { return routeQuery.value }, get path() { return routePath.value } }),
  useRouter: () => ({
    replace: (target: { path: string, query: Record<string, unknown> }) => {
      replaceCalls.push(target)
      routeQuery.value = target.query
    },
  }),
}))

const { useOpenApeOAuthError, DEFAULT_OAUTH_ERROR_MESSAGES } = await import('../src/runtime/composables/useOpenApeOAuthError')

describe('useOpenApeOAuthError', () => {
  it('returns null when there is no `error` in the query', () => {
    routeQuery.value = {}
    const { error } = useOpenApeOAuthError()
    expect(error.value).toBeNull()
  })

  it('maps known error codes to default friendly copy', () => {
    routeQuery.value = { error: 'access_denied', state: 'xyz' }
    const { error } = useOpenApeOAuthError()
    expect(error.value).toMatchObject({
      code: 'access_denied',
      message: DEFAULT_OAUTH_ERROR_MESSAGES.access_denied,
    })
  })

  it('falls back to a generic message for unknown error codes', () => {
    routeQuery.value = { error: 'something_weird' }
    const { error } = useOpenApeOAuthError()
    expect(error.value?.message).toContain('something_weird')
  })

  it('honours per-call message overrides on top of defaults', () => {
    routeQuery.value = { error: 'access_denied' }
    const { error } = useOpenApeOAuthError({
      messages: { access_denied: 'Custom Plans copy.' },
    })
    expect(error.value?.message).toBe('Custom Plans copy.')
  })

  it('exposes RFC 6749 error_description when supplied', () => {
    routeQuery.value = { error: 'access_denied', error_description: 'SP not on allowlist' }
    const { error } = useOpenApeOAuthError()
    expect(error.value?.description).toBe('SP not on allowlist')
  })

  it('dismiss() strips OAuth params from the URL but keeps unrelated ones', () => {
    routeQuery.value = {
      error: 'access_denied',
      error_description: 'foo',
      state: 'xyz',
      // Unrelated query the SP put there for its own routing.
      tab: 'features',
    }
    routePath.value = '/'
    replaceCalls.length = 0

    const { dismiss, error } = useOpenApeOAuthError()
    expect(error.value).not.toBeNull()
    dismiss()

    expect(replaceCalls).toHaveLength(1)
    expect(replaceCalls[0]).toEqual({ path: '/', query: { tab: 'features' } })
    // After dismiss the computed re-evaluates and reports null.
    expect(error.value).toBeNull()
  })
})
