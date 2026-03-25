import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GrantApprovalPage from '../src/runtime/pages/grant-approval.vue'
import GrantsPage from '../src/runtime/pages/grants.vue'
import {
  __resetNuxtImportsMocks,
  __setFetchUser,
  __setNavigateTo,
  __setRouteQuery,
  __setUser,
} from './mocks/nuxt-imports'

function buildCliGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    status: 'pending',
    created_at: 1_710_000_000,
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
  },
  emits: ['update:modelValue'],
  template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', ($event.target as HTMLSelectElement).value)"><slot /></select>',
})

const UInputStub = defineComponent({
  props: {
    modelValue: { type: [String, Number], default: '' },
  },
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', ($event.target as HTMLInputElement).value)" />',
})

const globalStubs = {
  UCard: UCardStub,
  UAlert: UAlertStub,
  UButton: UButtonStub,
  UBadge: UBadgeStub,
  URadioGroup: URadioGroupStub,
  USelect: USelectStub,
  UInput: UInputStub,
}

describe('grant approval pages', () => {
  beforeEach(() => {
    __resetNuxtImportsMocks()
    __setUser({ email: 'approver@example.com' })
    __setFetchUser(async () => {})
    vi.unstubAllGlobals()
  })

  it('renders a pending CLI grant and approves it from the single-grant page', async () => {
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
    const fetchMock = vi.fn()
      // Initial load: active section
      .mockResolvedValueOnce({
        data: [
          buildCliGrant(),
          buildCliGrant({
            id: 'grant-2',
            status: 'approved',
            request: {
              ...buildCliGrant().request,
              grant_type: 'always',
            },
            decided_by: 'approver@example.com',
          }),
        ],
      })
      // Initial load: history section
      .mockResolvedValueOnce({ data: [], pagination: { cursor: null, has_more: false } })
      // Approve call
      .mockResolvedValueOnce({ id: 'grant-1', status: 'approved' })
      // Refresh after approve: active section
      .mockResolvedValueOnce({
        data: [
          buildCliGrant({
            id: 'grant-1',
            status: 'approved',
            request: {
              ...buildCliGrant().request,
              grant_type: 'always',
            },
            decided_by: 'approver@example.com',
          }),
        ],
      })
      // Refresh after approve: history section
      .mockResolvedValueOnce({ data: [], pagination: { cursor: null, has_more: false } })
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('Pending Requests')
    expect(wrapper.text()).toContain('List DNS records in Exoscale domain "example.com"')

    await wrapper.findAll('button').find(button => button.text() === 'Approve')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/approve', {
      method: 'POST',
      body: {
        grant_type: 'once',
      },
    })
    expect(wrapper.text()).toContain('Active Permissions')
  })

  it('denies a pending grant from the dashboard', async () => {
    const fetchMock = vi.fn()
      // Initial load: active section
      .mockResolvedValueOnce({
        data: [buildCliGrant()],
      })
      // Initial load: history section
      .mockResolvedValueOnce({ data: [], pagination: { cursor: null, has_more: false } })
      // Deny call
      .mockResolvedValueOnce({ id: 'grant-1', status: 'denied' })
      // Refresh after deny: active section
      .mockResolvedValueOnce({
        data: [],
      })
      // Refresh after deny: history section
      .mockResolvedValueOnce({
        data: [
          buildCliGrant({
            status: 'denied',
          }),
        ],
        pagination: { cursor: null, has_more: false },
      })
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = mount(GrantsPage, { global: { stubs: globalStubs } })
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text() === 'Deny')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/grants/grant-1/deny', { method: 'POST' })
    expect(wrapper.text()).toContain('History')
  })
})
