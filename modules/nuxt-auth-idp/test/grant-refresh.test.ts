import { defineComponent } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GrantApprovalPage from '../src/runtime/pages/grant-approval.vue'
import GrantsPage from '../src/runtime/pages/grants.vue'
import cardFixtures from './fixtures/grant-cards.json'
import { __resetNuxtImportsMocks, __setNavigateTo, __setRouteQuery } from './mocks/nuxt-imports'

enableAutoUnmount(afterEach)
const stubs = {
  UButton: defineComponent({ props: { disabled: Boolean }, template: '<button :disabled="disabled"><slot /></button>' }),
  USelect: defineComponent({ props: ['modelValue', 'items'], emits: ['update:modelValue'], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>' }),
  UInput: defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' }),
  UAlert: defineComponent({ props: ['title'], template: '<div>{{ title }}<slot name="description" /></div>' }),
  UCard: defineComponent({ template: '<div><slot /></div>' }),
  UBadge: true,
  UModal: true,
  URadioGroup: true,
  IdpPage: defineComponent({ template: '<div><slot /></div>' }),
}
const grant = (id: string, title: string) => ({ ...structuredClone(cardFixtures.unknown), id, request: { ...structuredClone(cardFixtures.unknown.request), summary: { title } } })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => { __resetNuxtImportsMocks(); vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB') })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('offers a fallback command rule only for a registered agent', async () => {
  const request = grant('unknown-requester', 'List messages')
  request.request.command = ['tool', 'mail', 'list']
  __setRouteQuery({ grant_id: request.id })
  vi.stubGlobal('$fetch', vi.fn(async () => request))
  const wrapper = mount(GrantApprovalPage, { global: { stubs } })
  await flushPromises()
  expect(wrapper.find('[data-broader-permission]').exists()).toBe(false)
  const registered = { ...request, id: 'registered-requester', card: { ...request.card, requester: { name: 'Message agent', owner: 'owner@example.test' } } }
  vi.stubGlobal('$fetch', vi.fn(async () => registered))
  __setRouteQuery({ grant_id: registered.id })
  await flushPromises()
  expect(wrapper.find('input[value="rule"]').exists()).toBe(true)
})

it('ignores an earlier request response after navigation to a different approval', async () => {
  const first = deferred<ReturnType<typeof grant>>()
  const second = grant('grant-b', 'Second request')
  __setRouteQuery({ grant_id: 'grant-a' })
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.endsWith('/grant-a') ? first.promise : second))
  const wrapper = mount(GrantApprovalPage, { global: { stubs } })
  await flushPromises()
  __setRouteQuery({ grant_id: 'grant-b' })
  await flushPromises()
  expect(wrapper.get('[data-requester-headline]').text()).toBe('Second request')
  first.resolve(grant('grant-a', 'First request'))
  await flushPromises()
  expect(wrapper.get('[data-requester-headline]').text()).toBe('Second request')
})

it('ignores a decision response that belongs to the previously displayed approval', async () => {
  const decision = deferred<unknown>()
  const first = grant('grant-a', 'First request')
  const second = grant('grant-b', 'Second request')
  const navigate = vi.fn()
  __setNavigateTo(navigate)
  __setRouteQuery({ grant_id: first.id, callback: 'https://first.example.test/callback' })
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.endsWith('/approve') ? decision.promise : url.endsWith('/grant-a') ? first : second))
  const wrapper = mount(GrantApprovalPage, { global: { stubs } })
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
  __setRouteQuery({ grant_id: second.id, callback: 'https://second.example.test/callback' })
  await flushPromises()
  decision.resolve({ grant: { ...first, status: 'approved' }, authz_jwt: 'first-token' })
  await flushPromises()
  expect(wrapper.get('[data-requester-headline]').text()).toBe('Second request')
  expect(navigate).not.toHaveBeenCalled()
})

it('uses fresh server scope and validity after an inbox decision instead of a cached pending request', async () => {
  const pending = grant('grant-a', 'Specific request')
  const approved = { ...pending, status: 'approved', request: { ...pending.request, grant_type: 'always', summary: { title: 'Fresh server request' }, permissions: ['new-server-scope'] } }
  let decided = false
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/approve')) { decided = true; return { grant: approved } }
    if (url.includes('section=active')) return { data: [decided ? approved : pending] }
    if (url.includes('section=history')) return { data: [], pagination: { cursor: null, has_more: false } }
    return pending
  }))
  const wrapper = mount(GrantsPage, { global: { stubs } })
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-requester-headline]').text()).toBe('Fresh server request')
  expect(wrapper.get('[data-grant-validity]').text()).toContain('Continuing, until revoked')
  expect(wrapper.get('[data-grant-technical]').text()).toContain('new-server-scope')
})

it('creates only a future rule for an abandoned request without approving it or following its callback', async () => {
  const abandoned = { ...structuredClone(cardFixtures.gitPush), request: { ...structuredClone(cardFixtures.gitPush.request), waits_until: Math.floor(Date.now() / 1000) - 1 } }
  const navigate = vi.fn()
  __setNavigateTo(navigate)
  __setRouteQuery({ grant_id: abandoned.id, callback: 'https://agent.example.test/callback' })
  const fetch = vi.fn(async (url: string) => url === '/api/standing-grants' ? { id: 'future-rule' } : abandoned)
  vi.stubGlobal('$fetch', fetch)
  const wrapper = mount(GrantApprovalPage, { global: { stubs } })
  await flushPromises()
  ;(wrapper.get('[data-broader-permission]').element as HTMLDetailsElement).open = true
  await wrapper.get('input[value="rule"]').setValue()
  await wrapper.findAll('button').find(button => button.text() === 'Create rule')!.trigger('click')
  await flushPromises()
  expect(fetch.mock.calls.filter(([url]) => url === '/api/standing-grants')).toHaveLength(1)
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/approve'))).toBe(false)
  expect(wrapper.text()).toContain('Rule saved for future requests')
  expect(wrapper.text()).not.toContain('Grant approved')
  expect(navigate).not.toHaveBeenCalled()
})
