import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import IdpLoginForm from '../src/components/IdpLoginForm.vue'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('idpLoginForm', () => {
  it('prefills the email input from loginHint and enables submit', () => {
    const wrapper = mount(IdpLoginForm, { props: { loginHint: 'ape@example.com' } })
    const input = wrapper.get('input#idp-email')
    expect((input.element as HTMLInputElement).value).toBe('ape@example.com')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  })

  it('shows the server error when the challenge request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ title: 'Unknown user' }, 400)))
    const wrapper = mount(IdpLoginForm, { props: { loginHint: 'ape@example.com' } })

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Unknown user')
    expect(wrapper.emitted('success')).toBeUndefined()
  })

  it('emits success after challenge, login, and user fetch succeed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/auth/challenge') return jsonResponse({ challenge: 'nonce' })
      if (url === '/api/session/login') return jsonResponse({})
      if (url === '/api/me') return jsonResponse({ email: 'ape@example.com', name: 'Ape', isAdmin: false })
      return jsonResponse({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(IdpLoginForm, { props: { loginHint: 'ape@example.com' } })

    await wrapper.get('form').trigger('submit')
    // One flushPromises is not enough in a real browser: native
    // Response.json() resolves through the streams machinery (own event-loop
    // turns), so poll until the three-fetch chain has completed.
    await vi.waitFor(() => expect(wrapper.emitted('success')).toHaveLength(1))

    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'include' }))
  })
})
