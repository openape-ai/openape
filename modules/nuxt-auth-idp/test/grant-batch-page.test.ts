import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GrantApprovalPage from '../src/runtime/pages/grant-approval.vue'
import GrantsPage from '../src/runtime/pages/grants.vue'
import type { GrantWithCard } from '../src/runtime/utils/grant-card'
import { grantBatchRows, grantBatchSections } from '../src/runtime/utils/grant-batch'
import cardFixtures from './fixtures/grant-cards.json'
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
      summary: { title: `"Newsletter XY" <news@xy.example> – Issue ${index}`, description: 'more detail' },
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

  it('keeps members of the same second in a stable binding-line order', async () => {
    // Subjects sort the other way round; the order follows what each approval binds.
    const same = (id: string, subject: string) => member(id, 0, { request: { ...member(id, 0).request, summary: { title: subject } } })
    const { wrapper } = await mountBatch([same('g-c', 'A – first by title'), same('g-a', 'C – last by title'), same('g-b', 'B')])
    expect(wrapper.findAll('[data-batch-row]').map(row => row.attributes('data-batch-row'))).toEqual(['g-a', 'g-b', 'g-c'])
  })

  it('marks a registry row line that contains values the approval does not bind', async () => {
    const pod = { ...cardFixtures.podRun, id: 'g-1', request: { ...cardFixtures.podRun.request, requester: 'pod-agent@example.com', batch: { id: 'b-1', size: 1 } } }
    const { wrapper } = await mountBatch([pod])
    const row = wrapper.find('[data-batch-row="g-1"]')
    expect(row.find('[data-binding-line="registry"]').text()).toBe('Mail digest')
    expect(row.find('[data-requested-marker]').text()).toBe('as requested')
  })

  it('leads an exact command row with the marked requester title and keeps the bound line below it', async () => {
    const titled = member('g-1', 1, { request: { ...member('g-1', 1).request, summary: { title: 'Read-only status check' } } })
    const { wrapper } = await mountBatch([titled, member('g-2', 2, { status: 'denied', decided_at: 1_710_000_100 })])
    for (const id of ['g-1', 'g-2']) {
      const row = wrapper.find(`[data-batch-row="${id}"]`)
      const headline = row.find('[data-requester-headline]')
      expect(headline.text()).toBe(`${id === 'g-1' ? 'Read-only status check' : '"Newsletter XY" <news@xy.example> – Issue 2'}as requested`)
      expect(headline.find('[data-requested-marker]').exists()).toBe(true)
      expect(row.find('[data-command-head]').text()).toBe('pods-graph-gate approve')
      expect(row.findAll('[data-command-fact]').map(fact => fact.text())).toEqual([`item:${id}`])
      expect(row.find('[data-row-claim]').exists()).toBe(false)
    }
  })

  it('lets the bound line lead without a usable title and keeps a registry title in the lead', async () => {
    const untitled = member('g-1', 1, { request: { ...member('g-1', 1).request, summary: undefined } })
    const unsafe = member('g-2', 2, { request: { ...member('g-2', 2).request, summary: { title: 'Archive\u202Eevil' } } })
    const shaped = { ...cardFixtures.gitPush, id: 'g-3', created_at: 1_710_000_003, request: { ...cardFixtures.gitPush.request, requester: 'pod-agent@example.com', batch: { id: 'b-1', size: 3 } } }
    const { wrapper } = await mountBatch([untitled, unsafe, shaped])

    expect(wrapper.find('[data-requester-headline]').exists()).toBe(false)
    expect(wrapper.find('[data-batch-row="g-1"] [data-row-claim]').exists()).toBe(false)
    expect(wrapper.find('[data-batch-row="g-2"] [data-row-claim]').text()).toBe('requester\'s description: "Archive\u202Eevil"')
    const registry = wrapper.find('[data-batch-row="g-3"]')
    expect(registry.find('[data-binding-line="registry"]').text()).toBe('Push feature/rebase to origin')
    expect(registry.find('[data-row-claim]').text()).toBe('requester\'s description: "Read-only status check"')
  })

  it('selects the row headline only for exact commands with a safe title', () => {
    const rows = grantBatchRows([
      member('g-1', 1) as unknown as GrantWithCard,
      member('g-2', 2, { request: { ...member('g-2', 2).request, summary: { title: 'two\nlines' } } }) as unknown as GrantWithCard,
      { ...cardFixtures.gitPush, id: 'g-3', created_at: 1_710_000_003 } as unknown as GrantWithCard,
    ], 'en')
    expect(rows.map(row => [row.id, row.headline, row.claim])).toEqual([
      ['g-1', '"Newsletter XY" <news@xy.example> – Issue 1', null],
      ['g-2', null, 'two\nlines'],
      ['g-3', null, 'Read-only status check'],
    ])
  })

  it('decides only the open members and keeps decided ones in a closed history, newest first', async () => {
    const decided = (id: string, index: number, status: string, at: Record<string, number>) => member(id, index, { status, ...at })
    const { wrapper, calls } = await mountBatch([
      decided('g-1', 1, 'used', { decided_at: 1_710_000_100, used_at: 1_710_000_200 }),
      member('g-2', 2),
      decided('g-3', 3, 'denied', { decided_at: 1_710_000_300 }),
      decided('g-4', 4, 'expired', {}),
      member('g-5', 5),
    ])

    expect(wrapper.findAll('[data-batch-rows] [data-batch-row]').map(row => row.attributes('data-batch-row'))).toEqual(['g-2', 'g-5'])
    const history = wrapper.find('[data-batch-history]')
    expect((history.element as HTMLDetailsElement).open).toBe(false)
    expect(history.find('summary').text()).toBe('Already decided (3)')
    expect(history.findAll('[data-batch-row]').map(row => row.attributes('data-batch-row'))).toEqual(['g-3', 'g-1', 'g-4'])
    expect(history.findAll('[data-row-status]').map(status => status.text())).toEqual(['denied', 'used', 'expired'])
    expect(history.find('input').exists()).toBe(false)
    expect(history.find('[data-batch-row="g-1"] a').attributes('href')).toBe('/grant-approval?grant_id=g-1')

    await button(wrapper, 'Approve 2').trigger('click')
    await flushPromises()
    expect(calls.find(call => call.url === '/api/grants/batch')?.opts?.body).toEqual({ operations: [{ id: 'g-2', action: 'approve' }, { id: 'g-5', action: 'approve' }] })
  })

  it('says that nothing is open and still offers the history in German', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-AT')
    const { wrapper } = await mountBatch([member('g-1', 1, { status: 'approved', decided_at: 1_710_000_100 }), member('g-2', 2, { status: 'revoked', decided_at: 1_710_000_200 })])

    expect(wrapper.text()).toContain('Keine offene Anfrage in diesem Batch.')
    expect(wrapper.find('[data-batch-rows]').exists()).toBe(false)
    expect(wrapper.find('[data-batch-history] summary').text()).toBe('Bereits entschieden (2)')
    expect(wrapper.findAll('[data-row-status]').map(status => status.text())).toEqual(['widerrufen', 'freigegeben'])
    expect(button(wrapper, 'Alle ablehnen')).toBeUndefined()
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

describe('grant batch sections', () => {
  const grant = (id: string, created: number, status: string, extra: Record<string, unknown> = {}) => ({
    id,
    status,
    created_at: created,
    request: { requester: 'pod-agent@example.com', target_host: 'pods:demo', audience: 'pods-graph-gate', grant_type: 'once', command: ['pods-graph-gate', 'approve', `{"item":"${id}"}`] },
    ...extra,
  }) as unknown as GrantWithCard

  it('splits open, separately reviewed and decided members and orders the history newest first', () => {
    const lasting = { ...grant('p-2', 2, 'pending'), request: { ...grant('p-2', 2, 'pending').request, grant_type: 'always' } } as GrantWithCard
    const sections = grantBatchSections(grantBatchRows([
      grant('d-old', 1, 'approved', { decided_at: 10 }),
      grant('p-1', 3, 'pending'),
      lasting,
      grant('d-used', 4, 'used', { decided_at: 11, used_at: 40 }),
      grant('d-expired-a', 5, 'expired'),
      grant('d-expired-b', 6, 'expired'),
      grant('d-new', 7, 'denied', { decided_at: 30 }),
    ], 'en'))

    expect(sections.open.map(row => row.id)).toEqual(['p-1'])
    expect(sections.separate.map(row => row.id)).toEqual(['p-2'])
    // Use, then decision time; members without a recorded time last, the later submission first.
    expect(sections.decided.map(row => row.id)).toEqual(['d-used', 'd-new', 'd-old', 'd-expired-b', 'd-expired-a'])
  })
})
