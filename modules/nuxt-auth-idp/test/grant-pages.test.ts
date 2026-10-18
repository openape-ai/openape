import { defineComponent } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GrantApprovalPage from '../src/runtime/pages/grant-approval.vue'
import GrantsPage from '../src/runtime/pages/grants.vue'
import GrantDecisionForm from '../src/runtime/components/GrantDecisionForm.vue'
import cardFixtures from './fixtures/grant-cards.json'
import {
  __resetNuxtImportsMocks,
  __setFetchUser,
  __setNavigateTo,
  __setRouteQuery,
  __setUser,
} from './mocks/nuxt-imports'

const POD_ID = '00000000-0000-4000-8000-000000000001'
enableAutoUnmount(afterEach)

function buildCliGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    status: 'pending',
    created_at: 1_710_000_000,
    card: { registry: null, requester: { name: 'Test agent', owner: 'owner@example.test' } },
    request: {
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'once',
      command: ['exo', 'dns', 'show', 'example.com'],
      permissions: ['exo.account[name=current].dns-domain[name=example.com].dns-record[*]#list'],
      authorization_details: [
        {
          type: 'openape_cli',
          cli_id: 'exo',
          operation_id: 'dns.show',
          resource_chain: [
            { resource: 'account', selector: { name: 'current' } },
            { resource: 'dns-domain', selector: { name: 'example.com' } },
            { resource: 'dns-record' },
          ],
          action: 'list',
          permission: 'exo.account[name=current].dns-domain[name=example.com].dns-record[*]#list',
          display: 'List DNS records in Exoscale domain "example.com"',
          risk: 'low',
        },
      ],
      reason: 'Inspect current DNS state',
    },
    ...overrides,
  }
}

const UCardStub = defineComponent({
  template: '<div><slot name="header" /><slot /></div>',
})

const UAlertStub = defineComponent({
  props: {
    title: { type: String, default: '' },
  },
  template: '<div><div>{{ title }}</div><slot /><slot name="description" /></div>',
})

const UButtonStub = defineComponent({
  props: {
    to: { type: String, default: undefined },
  },
  emits: ['click'],
  template: '<button :data-to="to" @click="$emit(\'click\')"><slot /></button>',
})

const UBadgeStub = defineComponent({
  props: {
    label: { type: String, default: '' },
  },
  template: '<span>{{ label }}</span>',
})

const URadioGroupStub = defineComponent({
  props: {
    modelValue: { type: String, default: 'once' },
  },
  emits: ['update:modelValue'],
  template: '<div data-radio-group><slot /></div>',
})

const USelectStub = defineComponent({
  props: {
    modelValue: { type: String, default: '' },
    items: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
})

const UInputStub = defineComponent({
  props: {
    modelValue: { type: [String, Number], default: '' },
  },
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})

const globalStubs = {
  UCard: UCardStub,
  UAlert: UAlertStub,
  UButton: UButtonStub,
  UBadge: UBadgeStub,
  URadioGroup: URadioGroupStub,
  USelect: USelectStub,
  UInput: UInputStub,
  UModal: true,
  IdpPage: defineComponent({ template: '<main><slot /></main>' }),
}

async function selectRule(wrapper: VueWrapper) {
  const broader = wrapper.find('[data-broader-permission]')
  ;(broader.element as HTMLDetailsElement).open = true
  await broader.find('input[type="radio"][value="rule"]').setValue()
}

describe('grant approval pages', () => {
  beforeEach(() => {
    __resetNuxtImportsMocks()
    __setUser({ email: 'approver@example.com' })
    __setFetchUser(async () => {})
    vi.unstubAllGlobals()
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB')
  })

  it('offers only one exact approval for registry-protected operations on both pages', async () => {
    const grant = buildCliGrant()
    Object.assign(grant.request.authorization_details[0]!, { constraints: { exact_command: true, single_use: true } })
    for (const component of [GrantApprovalPage, GrantsPage]) {
      __setRouteQuery({ grant_id: grant.id })
      const { fetchMock, calls } = routedFetchMock(grant)
      vi.stubGlobal('$fetch', fetchMock)
      const wrapper = mount(component, { global: { stubs: globalStubs } })
      await flushPromises()
      expect(wrapper.find('[data-broader-permission]').exists()).toBe(false)
      expect(wrapper.find('[data-validity-control] select').findAll('option').map(option => option.attributes('value'))).toEqual(['once'])
      await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
      await flushPromises()
      expect(calls.find(call => call.url.endsWith('/approve'))?.opts.body).toMatchObject({ grant_type: 'once' })
      wrapper.unmount()
    }
  })

  it('renders a pending CLI grant and approves it once from the single-grant page', async () => {
    __setRouteQuery({ grant_id: 'grant-1' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(buildCliGrant())
      .mockResolvedValueOnce({
        grant: buildCliGrant({
          status: 'approved',
          decided_by: 'approver@example.com',
        }),
        authz_jwt: 'jwt-token',
      })
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantApprovalPage, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('List DNS records in Exoscale domain "example.com"')
    expect(wrapper.text()).toContain('exo.account[name=current].dns-domain[name=example.com].dns-record[*]#list')

    await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/approve', {
      method: 'POST',
      body: {
        grant_type: 'once',
      },
    })
    expect(wrapper.text()).toContain('Grant approved')
  })

  it('shows title, description, origin and link of the requester summary on the approval page', async () => {
    __setRouteQuery({ grant_id: 'grant-1' })
    const grant = buildCliGrant()
    grant.request.summary = { title: 'List DNS records for the audit', description: 'Ticket 42\nRead only', origin: 'DNS audit Pod', link: 'https://tickets.example.com/42' }
    vi.stubGlobal('$fetch', routedFetchMock(grant).fetchMock)

    const wrapper = mount(GrantApprovalPage, { global: { stubs: globalStubs } })
    await flushPromises()

    const claims = wrapper.find('[data-requester-claims]')
    expect(claims.text()).toContain('Description from the requester')
    expect(claims.text()).toContain('List DNS records for the audit')
    expect(claims.text()).toContain('Ticket 42\nRead only')
    expect(claims.text()).toContain('Origin: DNS audit Pod')
    expect(wrapper.find('a[href="https://tickets.example.com/42"]').exists()).toBe(true)
  })

  it('creates a standing-grant rule only after explicitly selecting its preview', async () => {
    __setRouteQuery({ grant_id: 'grant-1' })
    const { fetchMock, calls } = routedFetchMock(buildCliGrant())
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantApprovalPage, { global: { stubs: globalStubs } })
    await flushPromises()

    const broader = wrapper.find('[data-broader-permission]')
    expect((broader.element as HTMLDetailsElement).open).toBe(false)
    expect(broader.find('summary').text()).toContain('Broader permission available')
    ;(broader.element as HTMLDetailsElement).open = true
    await broader.trigger('toggle')
    expect(wrapper.find('[data-rule-preview]').exists()).toBe(false)
    expect(calls.some(call => call.opts.method === 'POST')).toBe(false)

    await selectRule(wrapper)
    await flushPromises()

    // Inspecting and selecting a proposal does not save a decision.
    expect(calls.some(c => c.url.endsWith('/approve'))).toBe(false)
    // Proposal preview: first link keeps its selector, the rest wildcard.
    expect(wrapper.text()).toContain('exo.account[name=current].dns-domain[*].dns-record[*] — risk ≤ low')

    await wrapper.findAll('button').find(button => button.text() === 'Create rule + approve once')!.trigger('click')
    await flushPromises()

    expect(calls.find(c => c.url === '/api/standing-grants')?.opts.body).toMatchObject({
      delegate: 'agent@example.com',
      audience: 'shapes',
      target_host: 'macmini',
      cli_id: 'exo',
      resource_chain_template: [
        { resource: 'account', selector: { name: 'current' } },
        { resource: 'dns-domain' },
        { resource: 'dns-record' },
      ],
      max_risk: 'low',
      grant_type: 'always',
      reason: 'Rule created from grant grant-1',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/approve', {
      method: 'POST',
      body: { grant_type: 'once' },
    })
  })

  it('keeps the callback round-trip when approving the request', async () => {
    __setRouteQuery({ grant_id: 'grant-1', callback: 'https://agent.example.com/callback' })
    const navigateToMock = vi.fn(async (..._args: unknown[]) => {})
    __setNavigateTo(navigateToMock)
    const { fetchMock } = routedFetchMock(buildCliGrant())
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantApprovalPage, { global: { stubs: globalStubs } })
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledTimes(1)
    const [target, options] = navigateToMock.mock.calls[0]!
    const callback = new URL(String(target))
    expect(`${callback.origin}${callback.pathname}`).toBe('https://agent.example.com/callback')
    expect(Object.fromEntries(callback.searchParams)).toEqual({ grant_id: 'grant-1', authz_jwt: 'jwt-token', status: 'approved' })
    expect(options).toEqual({ external: true })
  })

  it('shows validity directly while broader permissions stay collapsed on the landing page', async () => {
    __setRouteQuery({ grant_id: 'grant-1' })
    const { fetchMock } = routedFetchMock(buildCliGrant())
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantApprovalPage, { global: { stubs: globalStubs } })
    await flushPromises()

    const validity = wrapper.find('[data-validity-control]')
    expect(validity.text()).toContain('Validity')
    expect((validity.find('select').element as HTMLSelectElement).value).toBe('once')
    expect((wrapper.find('[data-broader-permission]').element as HTMLDetailsElement).open).toBe(false)

    await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/approve', {
      method: 'POST',
      body: { grant_type: 'once' },
    })
  })

  it.each(['once', 'timed', 'always'])('preselects and submits the requested %s validity on both pages', async (grantType) => {
    const grant = buildCliGrant({ request: { ...buildCliGrant().request, grant_type: grantType, ...grantType === 'timed' ? { duration: 5400 } : {} } })
    for (const component of [GrantApprovalPage, GrantsPage]) {
      __setRouteQuery({ grant_id: grant.id })
      const { fetchMock, calls } = routedFetchMock(grant)
      vi.stubGlobal('$fetch', fetchMock)
      const wrapper = mount(component, { global: { stubs: globalStubs } })
      await flushPromises()

      expect((wrapper.find('[data-validity-control] select').element as HTMLSelectElement).value).toBe(grantType)
      if (grantType === 'timed') {
        expect((wrapper.find('#duration-grant-1').element as HTMLInputElement).value).toBe('90')
        expect(wrapper.find('[data-validity-control]').text()).toContain('1 h 30 min')
      }
      else {
        expect(wrapper.find('#duration-grant-1').exists()).toBe(false)
      }
      expect((wrapper.find('[data-broader-permission]').element as HTMLDetailsElement).open).toBe(false)
      await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
      await flushPromises()

      expect(calls.filter(call => call.opts.method === 'POST')).toEqual([{
        url: '/api/grants/grant-1/approve',
        opts: { method: 'POST', body: { grant_type: grantType, ...grantType === 'timed' ? { duration: 5400 } : {} } },
      }])
      wrapper.unmount()
    }
  })

  it.each([
    ['detail', GrantApprovalPage],
    ['list', GrantsPage],
  ])('preserves a manually changed duration when visibility reloads the same request on the %s', async (_name, component) => {
    __setRouteQuery({ grant_id: 'grant-1' })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const grant = buildCliGrant({ request: { ...buildCliGrant().request, grant_type: 'timed', duration: 5400 } })
    const { fetchMock, calls } = routedFetchMock(grant)
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = mount(component, { global: { stubs: globalStubs } })
    await flushPromises()

    await wrapper.find('#duration-grant-1').setValue('120')
    const initialReads = calls.filter(call => !call.opts.method).length
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(calls.filter(call => !call.opts.method).length).toBeGreaterThan(initialReads)
    expect((wrapper.find('#duration-grant-1').element as HTMLInputElement).value).toBe('120')
    expect((wrapper.find('[data-validity-control] select').element as HTMLSelectElement).value).toBe('timed')
    await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
    await flushPromises()
    expect(calls.find(call => call.url.endsWith('/approve'))?.opts.body).toEqual({ grant_type: 'timed', duration: 7200 })
  })

  it('resets validity, duration and broader selection when the form receives a different request', async () => {
    const first = buildCliGrant({ request: { ...buildCliGrant().request, grant_type: 'timed', duration: 5400 } })
    const next = buildCliGrant({ id: 'grant-2', request: { ...buildCliGrant().request, grant_type: 'timed', duration: 1800 } })
    const wrapper = mount(GrantDecisionForm, { props: { grant: first, german: false }, global: { stubs: globalStubs } })

    await wrapper.find('#duration-grant-1').setValue('120')
    await wrapper.find('[data-validity-control] select').setValue('always')
    await selectRule(wrapper)
    expect(wrapper.find('[data-rule-preview]').exists()).toBe(true)
    await wrapper.setProps({ grant: next })

    expect((wrapper.find('[data-validity-control] select').element as HTMLSelectElement).value).toBe('timed')
    expect((wrapper.find('#duration-grant-2').element as HTMLInputElement).value).toBe('30')
    expect((wrapper.find('input[value="exact"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('[data-rule-preview]').exists()).toBe(false)
    expect(wrapper.findAll('button').some(button => button.text() === 'Approve')).toBe(true)
  })

  it('renders the why-pending diagnostics the IdP attached', async () => {
    __setRouteQuery({ grant_id: 'grant-1' })
    const withDiag = buildCliGrant()
    withDiag.pending_diagnostics = [
      {
        source: 'yolo',
        reason: 'segments-not-allowed',
        summary: 'No allow pattern covers this command: jq -r ".[].id"',
        detail: { unmatchedSegments: ['jq -r ".[].id"'], segments: ['o365-cli mail list', 'jq -r ".[].id"'] },
      },
      {
        source: 'standing-grant',
        reason: 'no-covering-rule',
        summary: 'No standing rule covers all of: o365, jq. A rule is per CLI — a chain needs one for each.',
        detail: { cliIds: ['o365', 'jq'] },
      },
    ]
    const fetchMock = vi.fn().mockResolvedValueOnce(withDiag)
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantApprovalPage, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('Why this is waiting')
    expect(wrapper.text()).toContain('No allow pattern covers this command')
    expect(wrapper.text()).toContain('jq -r ".[].id"')
    expect(wrapper.text()).toContain('A rule is per CLI')
  })

  it('offers an editable allow-pattern instead of a rule for unshaped commands', async () => {
    __setRouteQuery({ grant_id: 'grant-1' })
    const generic = buildCliGrant()
    generic.request.command = ['bash', '-c', 'o365-cli mail list --top 5']
    generic.request.authorization_details = [{
      type: 'openape_cli',
      cli_id: 'jq',
      operation_id: '_generic.exec',
      resource_chain: [
        { resource: 'cli', selector: { name: 'jq' } },
        { resource: 'argv', selector: { hash: 'h' } },
      ],
      action: 'exec',
      permission: 'jq.cli[name=jq].argv[hash=h]#exec',
      display: 'Execute (unshaped): `jq .`',
      risk: 'high',
      constraints: { exact_command: true },
    }]
    const { fetchMock, calls } = routedFetchMock(generic)
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantApprovalPage, { global: { stubs: globalStubs } })
    await flushPromises()

    await selectRule(wrapper)
    await flushPromises()

    // No standing-grant template for an exact argv — a glob pattern instead,
    // prefilled from the unwrapped inner command.
    expect(wrapper.text()).not.toContain('risk ≤')
    const patternInput = wrapper.findAll('input')
      .find(i => (i.element as HTMLInputElement).value === 'o365-cli mail list *')
    expect(patternInput).toBeTruthy()

    await wrapper.findAll('button').find(button => button.text() === 'Create rule + approve once')!.trigger('click')
    await flushPromises()

    const put = calls.find(c => c.url.includes('/yolo-policy') && c.opts.method === 'PUT')
    expect(put?.opts.body).toMatchObject({
      mode: 'allow-list',
      allowPatterns: ['o365-cli mail list *'],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/approve', {
      method: 'POST',
      body: { grant_type: 'once' },
    })
  })

  it('denies a grant and redirects to the callback URL when present', async () => {
    __setRouteQuery({
      grant_id: 'grant-1',
      callback: 'https://agent.example.com/callback',
    })
    const navigateToMock = vi.fn(async () => {})
    __setNavigateTo(navigateToMock)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(buildCliGrant())
      .mockResolvedValueOnce({ status: 'denied' })
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantApprovalPage, { global: { stubs: globalStubs } })
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text() === 'Deny')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/deny', { method: 'POST' })
    expect(navigateToMock).toHaveBeenCalledWith('https://agent.example.com/callback?grant_id=grant-1&status=denied', { external: true })
  })

  it('loads the grant dashboard and approves a pending CLI grant', async () => {
    const active = buildCliGrant({
      id: 'grant-2',
      status: 'approved',
      request: { ...buildCliGrant().request, grant_type: 'always' },
      decided_by: 'approver@example.com',
    })
    const { fetchMock } = routedFetchMock(buildCliGrant(), [active])
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('Pending requests (1)')
    expect(wrapper.text()).toContain('Active Permissions (1)')
    expect(wrapper.text()).toContain('List DNS records in Exoscale domain "example.com"')

    await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/approve', {
      method: 'POST',
      body: { grant_type: 'once' },
    })
    expect(wrapper.text()).toContain('Pending requests (0)')
    expect(wrapper.text()).toContain('Active Permissions (2)')
  })

  function routedFetchMock(grant: ReturnType<typeof buildCliGrant>, additional: ReturnType<typeof buildCliGrant>[] = []) {
    let current = grant
    const calls: Array<{ url: string, opts: { method?: string, body?: Record<string, unknown> } }> = []
    const fetchMock = vi.fn(async (url: string, opts: { method?: string, body?: Record<string, unknown> } = {}) => {
      calls.push({ url, opts })
      if (url === `/api/grants/${grant.id}`) return { ...current, request: { ...current.request } }
      if (url.startsWith('/api/grants?section=active')) return { data: [current, ...additional].filter(item => item.status === 'pending' || item.status === 'approved') }
      if (url.startsWith('/api/grants?section=history')) return { data: [current, ...additional].filter(item => item.status !== 'pending' && item.status !== 'approved'), pagination: { cursor: null, has_more: false } }
      if (url.includes('/yolo-policy')) return opts.method === 'PUT' ? { ok: true } : { policy: null }
      if (url === '/api/standing-grants') return { id: 'sg-1' }
      if (url.endsWith('/approve')) {
        current = { ...current, status: 'approved' }
        return { id: grant.id, status: 'approved', grant: current, authz_jwt: 'jwt-token' }
      }
      if (url.endsWith('/deny')) {
        current = { ...current, status: 'denied' }
        return { id: grant.id, status: 'denied' }
      }
      return {}
    })
    return { fetchMock, calls }
  }

  it('shows an active standing grant what it lets through', async () => {
    const rule = {
      id: 'sg-9',
      status: 'approved',
      type: 'standing',
      created_at: 1_710_000_000,
      decided_by: 'owner@example.com',
      request: {
        type: 'standing',
        requester: 'agent@example.com',
        target_host: 'macmini',
        audience: 'shapes',
        grant_type: 'always',
        cli_id: 'exo',
        max_risk: 'medium',
        resource_chain_template: [
          { resource: 'account', selector: { name: 'current' } },
          { resource: 'dns-domain' },
          { resource: 'dns-record' },
        ],
        reason: 'Rule created from grant grant-1',
      },
    } as unknown as ReturnType<typeof buildCliGrant>
    vi.stubGlobal('$fetch', routedFetchMock(rule).fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('exo.account[name=current].dns-domain[*].dns-record[*] — risk ≤ medium')
  })

  it('shows the requester summary, marked as the requester\'s own claim', async () => {
    const grant = buildCliGrant()
    grant.request.summary = {
      title: 'Merge PR #1307 into main',
      description: 'CI: 4/4 passed\nNo conflicts',
      origin: 'PR merge Pod',
      link: 'https://git.openape.ai/openape-ai/openape/pulls/1307',
    }
    vi.stubGlobal('$fetch', routedFetchMock(grant).fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    const claims = wrapper.find('[data-requester-claims]')
    expect(claims.text()).toContain('Description from the requester')
    expect(claims.text()).toContain('Merge PR #1307 into main')
    expect(claims.text()).toContain('CI: 4/4 passed\nNo conflicts')
    expect(claims.text()).toContain('Origin: PR merge Pod')
    expect(wrapper.find('[data-binding-line]').text()).toBe('exo dns show example.com')
    expect(wrapper.find('a[href="https://git.openape.ai/openape-ai/openape/pulls/1307"]').exists()).toBe(true)
  })

  it('never turns an executable scheme into a link', async () => {
    const grant = buildCliGrant()
    grant.request.summary = { title: 'Harmless-looking text', link: 'javascript:alert(1)' }
    vi.stubGlobal('$fetch', routedFetchMock(grant).fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    // The text still shows — only the link is withheld.
    expect(wrapper.text()).toContain('Harmless-looking text')
    expect(wrapper.html()).not.toContain('javascript:alert(1)')
  })

  it('leads the list card with the requester title and keeps its exact command in closed details', async () => {
    const grant = { ...cardFixtures.unknown, request: { ...cardFixtures.unknown.request, summary: { title: 'Deploy the hotfix' } } } as unknown as ReturnType<typeof buildCliGrant>
    vi.stubGlobal('$fetch', routedFetchMock(grant).fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.find('[data-requester-headline]').text()).toBe('Deploy the hotfix')
    expect(wrapper.find('[data-requester-claims]').text()).toContain('Description from the requester')
    expect(wrapper.findAll('[data-requester-headline]')).toHaveLength(1)
    expect(wrapper.find('[data-bound-scope]').text()).toContain('This exact invocation')
    const technical = wrapper.find('[data-grant-technical]')
    expect((technical.element as HTMLDetailsElement).open).toBe(false)
    expect(technical.find('[data-raw-command]').text()).toBe('acme-cli deploy --env production')
  })

  it('can approve an exact request until revoked without selecting a broader rule', async () => {
    const { fetchMock, calls } = routedFetchMock(buildCliGrant())
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    const broader = wrapper.find('[data-broader-permission]')
    expect((broader.element as HTMLDetailsElement).open).toBe(false)
    ;(broader.element as HTMLDetailsElement).open = true
    await broader.trigger('toggle')

    // Expanding the alternatives preserves the exact scope and saves nothing.
    expect(calls.some(c => c.url.endsWith('/approve'))).toBe(false)
    expect((broader.find('input[value="exact"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('[data-rule-preview]').exists()).toBe(false)

    await wrapper.find('[data-validity-control] select').setValue('always')
    await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/approve', {
      method: 'POST',
      body: {
        grant_type: 'always',
      },
    })
    expect(calls.some(c => c.url === '/api/standing-grants' || c.opts.method === 'PUT')).toBe(false)
  })

  it.each([
    ['inbox', GrantsPage],
    ['detail', GrantApprovalPage],
  ])('approves a brokered grant for reuse from the %s without creating an ignored rule', async (_name, page) => {
    __setRouteQuery({ grant_id: 'grant-1' })
    const grant = buildCliGrant({ brokered: { connection_id: 'connection-1', broker_issuer: 'https://pods.example.com', agent_issuer: 'https://pods.example.com', owner: 'approver@example.com', key_id: 'agent-key' } })
    const { fetchMock, calls } = routedFetchMock(grant)
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = mount(page, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.find('[data-broader-permission]').exists()).toBe(false)
    await wrapper.find('[data-validity-control] select').setValue('always')
    await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
    await flushPromises()

    expect(calls.filter(call => call.opts.method === 'POST')).toEqual([
      { url: '/api/grants/grant-1/approve', opts: { method: 'POST', body: { grant_type: 'always' } } },
    ])
    expect(wrapper.text()).not.toContain('Create rule + approve once')
    wrapper.unmount()
  })

  it('creates a standing-grant rule for shaped requests and approves once', async () => {
    const { fetchMock, calls } = routedFetchMock(buildCliGrant())
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    await selectRule(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('exo.account[name=current].dns-domain[*].dns-record[*] — risk ≤ low')

    await wrapper.findAll('button').find(button => button.text() === 'Create rule + approve once')!.trigger('click')
    await flushPromises()

    const rulePost = calls.find(c => c.url === '/api/standing-grants')
    expect(rulePost?.opts.body).toMatchObject({
      delegate: 'agent@example.com',
      audience: 'shapes',
      target_host: 'macmini',
      cli_id: 'exo',
      resource_chain_template: [
        { resource: 'account', selector: { name: 'current' } },
        { resource: 'dns-domain' },
        { resource: 'dns-record' },
      ],
      max_risk: 'low',
      grant_type: 'always',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/approve', {
      method: 'POST',
      body: { grant_type: 'once' },
    })
  })

  it('creates an allow-pattern for free-form shell requests and approves once', async () => {
    const shellGrant = buildCliGrant({
      request: {
        ...buildCliGrant().request,
        requester: 'message-agent@id.example.test',
        audience: 'ape-shell',
        command: ['bash', '-c', 'o365-cli mail list --top 5'],
        authorization_details: undefined,
        permissions: undefined,
      },
    })
    const { fetchMock, calls } = routedFetchMock(shellGrant)
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    await selectRule(wrapper)
    await flushPromises()

    // Suggested pattern derived from the unwrapped inner command.
    const patternInput = wrapper.findAll('input').find(i => (i.element as HTMLInputElement).value === 'o365-cli mail list *')
    expect(patternInput).toBeTruthy()

    await wrapper.findAll('button').find(button => button.text() === 'Create rule + approve once')!.trigger('click')
    await flushPromises()

    const put = calls.find(c => c.url.includes('/yolo-policy') && c.opts.method === 'PUT')
    expect(put?.url).toContain(encodeURIComponent('message-agent@id.example.test'))
    expect(put?.url).toContain('audience=ape-shell')
    expect(put?.opts.body).toMatchObject({
      mode: 'allow-list',
      allowPatterns: ['o365-cli mail list *'],
      denyPatterns: [],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/approve', {
      method: 'POST',
      body: { grant_type: 'once' },
    })
  })

  it('keeps the unwrapped shell invocation and full requester identity inspectable', async () => {
    const shellGrant = buildCliGrant({
      request: {
        ...buildCliGrant().request,
        requester: 'message-agent-11111111+owner+example_test@id.example.test',
        command: ['bash', '-c', 'o365-cli calendar today'],
      },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ data: [shellGrant] })
      .mockResolvedValueOnce({ data: [], pagination: { cursor: null, has_more: false } })
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    const commandBlock = wrapper.find('[data-raw-command]')
    expect(commandBlock.text()).toBe('o365-cli calendar today')
    expect(wrapper.text()).toContain('via bash')
    expect(wrapper.find('[data-requester-identity]').text()).toContain(shellGrant.request.requester)
  })

  it('shows requested validity directly and keeps broader scope choices collapsed in the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ data: [buildCliGrant()] })
      .mockResolvedValueOnce({ data: [], pagination: { cursor: null, has_more: false } })
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.find('[data-validity-control]').text()).toContain('Validity')
    expect((wrapper.find('[data-validity-control] select').element as HTMLSelectElement).value).toBe('once')
    const broader = wrapper.find('[data-broader-permission]')
    expect((broader.element as HTMLDetailsElement).open).toBe(false)
    ;(broader.element as HTMLDetailsElement).open = true
    await broader.trigger('toggle')
    expect(broader.text()).toContain('Create a rule for future requests')
    expect((broader.find('input[value="exact"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.findAll('button').some(button => button.text() === 'Approve')).toBe(true)
  })

  it('denies a pending grant from the dashboard', async () => {
    const { fetchMock } = routedFetchMock(buildCliGrant())
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text() === 'Deny')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/deny', { method: 'POST' })
    expect(wrapper.text()).toContain('Pending requests (0)')
    expect(wrapper.text()).toContain('History (1)')
  })
  describe('a card says whether anybody is still waiting', () => {
    const NOW = Math.floor(Date.now() / 1000)

    function waitingGrant(waitsUntil: number) {
      const g = buildCliGrant()
      g.created_at = NOW - 10
      ;(g.request as Record<string, unknown>).waits_until = waitsUntil
      return g
    }

    it.each([
      ['en-GB', 'The process is still waiting', 'Approve'],
      ['de-AT', 'Der Prozess wartet noch', 'Freigeben'],
    ])('shows a countdown in %s while the requester still polls', async (language, waiting, approve) => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(language)
      const { fetchMock } = routedFetchMock(waitingGrant(NOW + 120))
      vi.stubGlobal('$fetch', fetchMock)

      const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
      await flushPromises()

      expect(wrapper.text()).toContain(waiting)
      expect(wrapper.findAll('button').some(b => b.text() === approve)).toBe(true)
    })

    it('calls a lapsed request abandoned and drops the button that cannot work', async () => {
      const { fetchMock } = routedFetchMock(waitingGrant(NOW - 1))
      vi.stubGlobal('$fetch', fetchMock)

      const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
      await flushPromises()

      expect(wrapper.text()).toContain('The requester has stopped waiting')
      // The whole point: approving "once" cannot make a dead command run, so the
      // button is gone rather than quietly doing nothing.
      expect(wrapper.findAll('button').some(b => b.text() === 'Approve')).toBe(false)
      // A future rule remains possible after an explicit scope selection.
      await selectRule(wrapper)
      expect(wrapper.findAll('button').some(b => b.text() === 'Create rule')).toBe(true)
      expect(wrapper.text()).toContain('The rule applies only to future matching requests.')
    })

    it('claims nothing when the requester never said', async () => {
      const { fetchMock } = routedFetchMock(buildCliGrant())
      vi.stubGlobal('$fetch', fetchMock)

      const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
      await flushPromises()

      expect(wrapper.text()).not.toContain('Aufgegeben')
      expect(wrapper.text()).not.toContain('Der Prozess wartet noch')
      expect(wrapper.text()).not.toContain('The requester has stopped waiting')
      expect(wrapper.text()).not.toContain('The process is still waiting')
      expect(wrapper.findAll('button').some(b => b.text() === 'Approve')).toBe(true)
    })
  })

  describe('generic card from registry data', () => {
    beforeEach(() => {
      __setRouteQuery({ grant_id: 'grant-1' })
    })

    async function mountCard(grant: unknown, language = 'en-GB') {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(language)
      const { fetchMock, calls } = routedFetchMock({ ...(grant as ReturnType<typeof buildCliGrant>), id: 'grant-1' })
      vi.stubGlobal('$fetch', fetchMock)
      const wrapper = mount(GrantApprovalPage, { global: { stubs: globalStubs } })
      await flushPromises()
      return { wrapper, calls }
    }

    it('renders the Pod run card from the pod-runtime adapter, switchable to German', async () => {
      const { wrapper, calls } = await mountCard(cardFixtures.podRun)

      expect(wrapper.find('[data-requester-headline]').text()).toBe('Run the stored script of Mail digest')
      expect(wrapper.find('[data-binding-line="registry"]').text()).toContain('Mail digest')
      // Name, script, workspace and environment are the requester's; only the Pod id is bound.
      expect(wrapper.find('[data-binding-line="registry"] [data-requested-marker]').text()).toBe('as requested')
      expect(wrapper.findAll('[data-registry-facts] [data-provenance="requested"]')).toHaveLength(3)
      expect(wrapper.findAll('[data-registry-facts] [data-provenance="requested"] [data-requested-marker]')).toHaveLength(3)
      expect((wrapper.find('[data-grant-technical]').element as HTMLDetailsElement).open).toBe(false)
      expect(wrapper.text()).toContain('Run the stored Pod script')
      expect(wrapper.text()).toContain('separately assigned permissions')
      expect(wrapper.text()).toContain('/Users/owner/Pods/mail-digest/workspace')
      expect(wrapper.text()).toContain('Environment variables')
      expect(wrapper.text()).toContain('/Users/owner/Pods/mail-digest/home')
      expect(wrapper.find('[data-requester-identity]').text()).toContain('Mail digest Pod')
      expect(wrapper.find('[data-requester-identity]').text()).toContain('Owner: owner@example.com')
      expect(wrapper.find('[data-validity-control]').text()).toContain('Continuing, until revoked')
      expect((wrapper.find('[data-validity-control] select').element as HTMLSelectElement).value).toBe('always')

      await wrapper.findAll('button').find(button => button.text() === 'Deutsch')!.trigger('click')
      expect(wrapper.text()).toContain('Gespeichertes Pod-Skript ausführen')
      expect(wrapper.text()).toContain('Arbeitsverzeichnis')
      expect(wrapper.text()).toContain('Umgebungsvariablen')
      expect(wrapper.find('[data-binding-line="registry"] [data-requested-marker]').text()).toBe('laut Anfrage')
      expect(wrapper.find('[data-requester-claims]').text()).toContain('Beschreibung vom Antragsteller')

      await selectRule(wrapper)
      await wrapper.findAll('button').find(button => button.text() === 'Regel erstellen + einmal freigeben')!.trigger('click')
      await flushPromises()
      expect(calls.find(c => c.url === '/api/standing-grants')?.opts.body).toMatchObject({ target_host: `pods:${POD_ID}`, cli_id: 'pod-runtime', resource_chain_template: [{ resource: 'pod', selector: { id: POD_ID } }] })
      expect(calls.find(c => c.url.endsWith('/approve'))?.opts.body).toEqual({ grant_type: 'once' })
    })

    it('leads with the requester title while preserving the actual write scope and exact command', async () => {
      const { wrapper } = await mountCard(cardFixtures.gitPush)

      expect(wrapper.find('[data-binding-line]').text()).toBe('Push feature/rebase to origin')
      expect(wrapper.find('[data-requested-marker]').exists()).toBe(false)
      expect(wrapper.find('[data-requester-claims]').text()).toContain('Read-only status check')
      expect(wrapper.find('[data-requester-headline]').text()).toBe('Read-only status check')
      expect(wrapper.find('[data-bound-scope]').text()).toContain('Writes to the server')
      expect(wrapper.text()).toContain('Covers only this exact command')
      expect((wrapper.find('[data-grant-technical]').element as HTMLDetailsElement).open).toBe(false)
      expect(wrapper.find('[data-exact-command]').text()).toContain('git -C /Users/owner/repos/iurio push --force-with-lease origin feature/rebase')
    })

    it('shows requester context once and keeps an unshaped exact command in closed details', async () => {
      const { wrapper } = await mountCard(cardFixtures.unknown)

      expect(wrapper.find('[data-requester-headline]').text()).toBe('Deploy the hotfix')
      expect(wrapper.find('[data-requester-claims]').text()).toContain('Description from the requester')
      expect(wrapper.find('[data-binding-line="command"]').text()).toBe('acme-cli deploy --env production')
      expect((wrapper.find('[data-grant-technical]').element as HTMLDetailsElement).open).toBe(false)
      expect(wrapper.findAll('[data-requester-headline]')).toHaveLength(1)
      expect(wrapper.find('[data-requester-claims]').text()).toContain('Ticket 7: roll out the login fix.')
      expect(wrapper.find('[data-requester-identity]').text()).toContain('Name unavailable')
      expect(wrapper.find('[data-requester-identity]').text()).toContain('agent@example.com')
    })

    it('uses a neutral heading without a requester title and retains the exact command', async () => {
      const { wrapper } = await mountCard({ ...cardFixtures.unknown, request: { ...cardFixtures.unknown.request, summary: undefined } })

      expect(wrapper.find('h2').text()).toBe('Permission request')
      expect(wrapper.find('[data-requester-headline]').exists()).toBe(false)
      expect((wrapper.find('[data-grant-technical]').element as HTMLDetailsElement).open).toBe(false)
      expect(wrapper.find('[data-binding-line="command"]').text()).toBe('acme-cli deploy --env production')
    })
  })
})
