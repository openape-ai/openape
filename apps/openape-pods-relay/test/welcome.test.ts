// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import WorkspaceWelcome from '../app/components/WorkspaceWelcome.vue'

afterEach(() => vi.unstubAllGlobals())
it('exposes the promoted Mac release and keeps workspace sign-in available', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: true, version: '0.2.0', minimumSystemVersion: '14.0', verifiedSystemVersion: '26.6.2', architecture: 'arm64', downloadUrl: '/download/mac' }) })))
  const wrapper = mount(WorkspaceWelcome); await flushPromises()
  expect(wrapper.get('a[href="/download/mac"]').text()).toContain('Download for Mac')
  expect(wrapper.text()).toContain('Verified on macOS 26.6.2')
  expect(wrapper.find('input[type="email"]').exists()).toBe(true)
  wrapper.unmount()
})
it('does not advertise an unpublished binary and retries a failed release lookup', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: async () => ({ available: false }) })
  vi.stubGlobal('fetch', fetcher)
  const wrapper = mount(WorkspaceWelcome); await flushPromises()
  expect(wrapper.find('a[href="/download/mac"]').exists()).toBe(false)
  const retry = wrapper.findAll('button').find(button => button.text() === 'Try again')
  expect(retry).toBeDefined(); await retry!.trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('No Mac download is available')
  expect(wrapper.find('a[href="/download/mac"]').exists()).toBe(false)
  wrapper.unmount()
})
it('preserves input and shows a failed sign-in without claiming success', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ available: false }) }).mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Identity provider unavailable' }) })
  vi.stubGlobal('fetch', fetcher)
  const wrapper = mount(WorkspaceWelcome); await flushPromises()
  await wrapper.get('input[type="email"]').setValue('owner@example.com'); await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Identity provider unavailable')
  expect((wrapper.get('input[type="email"]').element as HTMLInputElement).value).toBe('owner@example.com')
  wrapper.unmount()
})
