import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import WorkspaceWelcome from '../../../openape-pods-relay/app/components/WorkspaceWelcome.vue'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('starts the existing DDISA workspace flow and prevents duplicate submissions', async () => {
  let finish: (value: Response) => void = () => { throw new Error('Request not started') }
  const request = vi.fn((url: string) => url === '/api/releases/current' ? Promise.resolve(new Response(JSON.stringify({ available: false }))) : new Promise<Response>((resolve) => { finish = resolve }))
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  vi.stubGlobal('fetch', request)
  wrapper = mount(WorkspaceWelcome)
  await wrapper.get('input').setValue('owner@example.com')
  await wrapper.get('form').trigger('submit')
  await wrapper.get('form').trigger('submit')
  expect(request.mock.calls.filter(([url]) => url === '/workspace-auth/login')).toHaveLength(1)
  expect(request).toHaveBeenCalledWith('/workspace-auth/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'owner@example.com' }), redirect: 'error' }))
  expect(wrapper.get('form button').attributes('disabled')).toBeDefined()
  expect(wrapper.get('form button').text()).toContain('Connecting')
  finish(new Response(JSON.stringify({ redirectUrl: 'https://id.example.com/authorize?state=synthetic' })))
  await flushPromises()
  expect(assign).toHaveBeenCalledExactlyOnceWith('https://id.example.com/authorize?state=synthetic')
})

it('keeps the email and allows retry after an identity discovery failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ statusMessage: 'Identity provider unavailable' }), { status: 503 })))
  wrapper = mount(WorkspaceWelcome)
  await wrapper.get('input').setValue('owner@example.com')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Identity provider unavailable')
  expect(wrapper.get('input').element.value).toBe('owner@example.com')
  expect(wrapper.get('form button').attributes('disabled')).toBeUndefined()
})

it('explains a failed callback and offers the workspace without local IdP registration', () => {
  wrapper = mount(WorkspaceWelcome, { props: { loginFailed: true } })
  expect(wrapper.get('[role="alert"]').text()).toContain('Sign-in could not be completed')
  expect(wrapper.get('a[href="/workspace"]').text()).toContain('Open workspace')
  expect(wrapper.find('a[href="/register-email"]').exists()).toBe(false)
})
