import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GrantApprovalPage from '../src/runtime/pages/grant-approval.vue'
import GrantsPage from '../src/runtime/pages/grants.vue'
import { __resetNuxtImportsMocks, __setFetchUser, __setRouteQuery, __setUser } from './mocks/nuxt-imports'

const stubs = {
  UCard: defineComponent({ template: '<div><slot name="header" /><slot /></div>' }),
  UAlert: defineComponent({ props: { title: { type: String, default: '' } }, template: '<div role="alert">{{ title }}<slot name="description" /></div>' }),
  UButton: defineComponent({ props: { to: { type: String, default: undefined }, disabled: { type: Boolean, default: false } }, emits: ['click'], template: '<button :data-to="to" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' }),
  UBadge: defineComponent({ props: { label: { type: String, default: '' } }, template: '<span>{{ label }}</span>' }),
}

const future = Math.floor(Date.now() / 1000) + 3600

function member(id: string, index: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'pending',
    created_at: 1_710_000_000 + index,
    request: {
      requester: 'pod-agent@example.com',
      target_host: 'pods:demo',
      audience: 'pods-graph-gate',
      grant_type: 'once',
      command: ['pods-graph-gate', 'approve', `{"item":"${id}"}`],
      summary: { text: `"Newsletter XY" <news@xy.example> – Issue ${index}\nmore detail` },
      waits_until: future,
      batch: { id: 'b-1', title: 'Newsletters, October 7', size: 3 },
    },
    ...overrides,
  }
}

function batchFetch(members: unknown[]) {
  const calls: { url: string, opts?: { method?: string, body?: unknown, query?: unknown } }[] = []
  const fetchMock = vi.fn(async (url: string, opts?: { method?: string, body?: { operations: { id: string, action: string }[] } }) => {
    calls.push({ url, opts })
    if (url === '/api/grants/batch') return { results: opts!.body!.operations.map(op => ({ id: op.id, status: op.action === 'approve' ? 'approved' : 'denied', success: true })) }
    return { data: members, pagination: { cursor: null, has_more: false } }
  })
  return { fetchMock, calls }
}

async function mountBatch(members: unknown[]) {
  __setRouteQuery({ requester: 'pod-agent@example.com', batch: 'b-1' })
  const { fetchMock, calls } = batchFetch(members)
  vi.stubGlobal('$fetch', fetchMock)
  const wrapper = mount(GrantApprovalPage, { global: { stubs } })
  await flushPromises()
  return { wrapper, calls }
}

const button = (wrapper: Awaited<ReturnType<typeof mountBatch>>['wrapper'], text: string) => wrapper.findAll('button').find(item => item.text().startsWith(text))!

describe('grant batch approval', () => {
  beforeEach(() => {
    __resetNuxtImportsMocks()
    __setUser({ email: 'owner@example.com' })
    __setFetchUser(async () => {})
    vi.unstubAllGlobals()
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB')
  })

  it('lists every member with its own description and a link to the exact request', async () => {
    const { wrapper, calls } = await mountBatch([member('g-1', 1), member('g-2', 2), member('g-3', 3)])

    expect(calls[0]).toMatchObject({ url: '/api/grants', opts: { query: { requester: 'pod-agent@example.com', batch: 'b-1', limit: 100 } } })
    expect(wrapper.text()).toContain('"Newsletters, October 7"')
    expect(wrapper.text()).toContain('3 of 3 requests received')
    expect(wrapper.text()).toContain('"Newsletter XY" <news@xy.example> – Issue 1')
    expect(wrapper.text()).not.toContain('more detail')
    expect(wrapper.find('[data-batch-row="g-2"] a').attributes('href')).toBe('/grant-approval?grant_id=g-2')
    expect(wrapper.findAll('[data-batch-rows] input[type="checkbox"]').every(box => (box.element as HTMLInputElement).checked)).toBe(true)
  })

  it('names the shared scope and leaves a differently scoped member to its single view', async () => {
    const lasting = member('g-2', 2, { request: { ...member('g-2', 2).request, grant_type: 'always' } })
    const foreign = member('g-3', 3, { request: { ...member('g-3', 3).request, target_host: 'pods:other' } })
    const { wrapper, calls } = await mountBatch([member('g-1', 1), lasting, foreign])

    expect(wrapper.find('[data-batch-scope]').text()).toBe('Single-use approvals for pods:demo · pods-graph-gate')
    expect(wrapper.find('#batch-g-2').exists()).toBe(false)
    expect(wrapper.find('#batch-g-3').exists()).toBe(false)
    expect(wrapper.find('[data-batch-row="g-2"]').text()).toContain('Review individually')
    await button(wrapper, 'Approve 1').trigger('click')
    await flushPromises()
    expect(calls.find(call => call.url === '/api/grants/batch')?.opts?.body).toEqual({ operations: [{ id: 'g-1', action: 'approve' }] })
  })

  it('keeps members of the same second in a stable label order', async () => {
    const same = (id: string, subject: string) => member(id, 0, { request: { ...member(id, 0).request, summary: { text: subject } } })
    const { wrapper } = await mountBatch([same('g-c', 'Newsletter – What is new'), same('g-a', 'Bank – Statement'), same('g-b', 'Newsletter – What else')])
    expect(wrapper.findAll('[data-batch-row]').map(row => row.attributes('data-batch-row'))).toEqual(['g-a', 'g-b', 'g-c'])
  })

  it('approves the selected members and denies the rest in one batch call', async () => {
    const { wrapper, calls } = await mountBatch([member('g-1', 1), member('g-2', 2), member('g-3', 3)])

    await wrapper.find('#batch-g-3').setValue(false)
    expect(button(wrapper, 'Approve 2 selected, deny 1').exists()).toBe(true)
    await button(wrapper, 'Approve 2 selected').trigger('click')
    await flushPromises()

    expect(calls.find(call => call.url === '/api/grants/batch')?.opts).toEqual({
      method: 'POST',
      body: { operations: [{ id: 'g-1', action: 'approve' }, { id: 'g-2', action: 'approve' }, { id: 'g-3', action: 'deny' }] },
    })
  })

  it('denies every open member with "Deny all"', async () => {
    const { wrapper, calls } = await mountBatch([member('g-1', 1), member('g-2', 2, { status: 'approved' }), member('g-3', 3)])

    expect(wrapper.find('#batch-g-2').exists()).toBe(false)
    expect(wrapper.find('[data-batch-row="g-2"]').text()).toContain('approved')
    await button(wrapper, 'Deny all').trigger('click')
    await flushPromises()

    expect(calls.find(call => call.url === '/api/grants/batch')?.opts?.body).toEqual({ operations: [{ id: 'g-1', action: 'deny' }, { id: 'g-3', action: 'deny' }] })
  })

  it('warns about missing members and blocks approval once the requester stopped waiting', async () => {
    const past = Math.floor(Date.now() / 1000) - 60
    const { wrapper } = await mountBatch([member('g-1', 1, { request: { ...member('g-1', 1).request, waits_until: past } })])

    expect(wrapper.text()).toContain('1 of 3 requests received')
    expect(wrapper.text()).toContain('2 requests have not arrived')
    expect(wrapper.text()).toContain('The requester has stopped waiting')
    expect(button(wrapper, 'Approve 1').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Deny all').attributes('disabled')).toBeUndefined()
  })

  it('shows pending batch members as one card linking to the batch view', async () => {
    const single = { ...member('g-9', 9), request: { ...member('g-9', 9).request, batch: undefined, summary: undefined, requester: 'other@example.com' } }
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.includes('section=active')
      ? { data: [member('g-1', 1), member('g-2', 2), single], pagination: { cursor: null, has_more: false } }
      : { data: [], pagination: { cursor: null, has_more: false } }))
    const wrapper = mount(GrantsPage, { global: { stubs } })
    await flushPromises()

    const cards = wrapper.findAll('[data-pending-batch]')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.text()).toContain('2 / 3')
    expect(cards[0]!.text()).toContain('„Newsletters, October 7“')
    expect(cards[0]!.find('button').attributes('data-to')).toBe('/grant-approval?requester=pod-agent%40example.com&batch=b-1')
    expect(wrapper.text()).not.toContain('Issue 1')
    expect(wrapper.text()).toContain('other@example.com')
  })
})
