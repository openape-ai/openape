// Owner-published shapes (issue 1551): the grant card marks a grant an
// owner's own shape resolved and lists every declared operation; the
// /shapes page lists, previews, publishes and removes owner shapes.

import { defineComponent } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GrantCard from '../src/runtime/components/GrantCard.vue'
import ShapesPage from '../src/runtime/pages/shapes.vue'
import type { GrantWithCard, OwnerShapeCard } from '../src/runtime/utils/grant-card'
import { __resetNuxtImportsMocks, __setFetchUser, __setUser } from './mocks/nuxt-imports'

enableAutoUnmount(afterEach)

const UBadgeStub = defineComponent({ props: { label: { type: String, default: '' } }, template: '<span data-badge>{{ label }}</span>' })
const UButtonStub = defineComponent({ props: { disabled: { type: Boolean, default: false } }, emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' })
const UAlertStub = defineComponent({ props: { title: { type: String, default: '' } }, template: '<div>{{ title }}</div>' })
const UTextareaStub = defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})
const stubs = {
  UBadge: UBadgeStub,
  UButton: UButtonStub,
  UAlert: UAlertStub,
  UTextarea: UTextareaStub,
  UCard: defineComponent({ template: '<div><slot name="header" /><slot /></div>' }),
  IdpPage: defineComponent({ template: '<main><slot /></main>' }),
  NuxtLink: defineComponent({ props: { to: { type: String, default: '' } }, template: '<a :href="to"><slot /></a>' }),
}

const ownerShape: OwnerShapeCard = {
  cli_id: 'jev',
  owner: 'owner@example.test',
  digest: 'sha256:4f1c0000000000000000b2e9',
  published_at: 1_762_160_400,
  current: true,
  operation_id: 'ask',
  operations: [
    { id: 'ask', command: ['ask'], display: 'Ask Jev a structured question', action: 'read', risk: 'low' },
    { id: 'reset', command: ['reset'], display: 'Reset the Jev state', action: 'delete', risk: 'high' },
  ],
}

function ownerGrant(shape: OwnerShapeCard): GrantWithCard {
  return {
    id: 'grant-1',
    status: 'pending',
    created_at: 1_762_160_500,
    card: { registry: null, requester: { name: 'task-monitor', owner: 'owner@example.test' }, owner_shape: shape },
    request: {
      requester: 'pod-1@example.test',
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'always',
      authorization_details: [{ type: 'openape_cli', cli_id: 'jev', operation_id: 'ask', resource_chain: [{ resource: 'model', selector: { name: 'jev' } }], action: 'read', permission: 'jev.model[name=jev]#read', display: 'Ask Jev a structured question', risk: 'low' }],
    },
  } as unknown as GrantWithCard
}

describe('GrantOwnerShape in the grant card', () => {
  it('marks the owner shape and highlights the requested operation among all declared ones', () => {
    const wrapper = mount(GrantCard, { props: { grant: ownerGrant(ownerShape), german: false, technical: false }, global: { stubs } })
    const block = wrapper.find('[data-owner-shape]')
    expect(block.text()).toContain('Owner shape · not from the registry')
    expect(block.text()).toContain('published by owner@example.test')
    expect(block.text()).toContain('4f1c00000000')
    expect(block.find('[data-owner-shape-stale]').exists()).toBe(false)
    const operations = block.findAll('[data-owner-shape-operation]')
    expect(operations.map(op => op.attributes('data-owner-shape-operation'))).toEqual(['ask', 'reset'])
    expect(operations[0]!.attributes('data-requested')).toBe('true')
    expect(operations[1]!.attributes('data-requested')).toBeUndefined()
    expect(operations[1]!.text()).toContain('Reset the Jev state')
    expect(operations[1]!.text()).toContain('delete')
    expect(operations[1]!.text()).toContain('high')
  })

  it('warns when the shape is no longer current, in German too', () => {
    const wrapper = mount(GrantCard, { props: { grant: ownerGrant({ ...ownerShape, current: false, published_at: null }), german: true, technical: false }, global: { stubs } })
    expect(wrapper.find('[data-owner-shape-stale]').text()).toContain('nach der Anfrage geändert oder entfernt')
    expect(wrapper.find('[data-owner-shape]').text()).toContain('Owner-Shape · nicht aus der Registry')
  })

  it('renders nothing without an owner shape', () => {
    const grant = ownerGrant(ownerShape)
    grant.card!.owner_shape = null
    const wrapper = mount(GrantCard, { props: { grant, german: false, technical: false }, global: { stubs } })
    expect(wrapper.find('[data-owner-shape]').exists()).toBe(false)
  })
})

const TOML = 'schema = "openape-shapes/v1"\n[cli]\nid = "jev"\nexecutable = "jev"\n[[operation]]\nid = "ask"\ncommand = ["ask"]\n'
const shapeView = {
  cli_id: 'jev',
  executable: 'jev',
  digest: 'sha256:4f1c0000000000000000b2e9',
  toml: TOML,
  operations: [{ id: 'ask', command: ['ask'], display: 'Ask Jev a structured question', action: 'read', risk: 'low', resource_chain: [] }],
  created_at: 1_762_160_400,
  published_at: 1_762_160_400,
  bound_grants: [{ id: 'g-1', requester: 'pod-1@example.test', operation_id: 'ask', grant_type: 'always', decided_at: 1_762_160_500, digest_current: true }],
}

describe('shapes page', () => {
  const calls: Array<{ url: string, opts: { method?: string, body?: Record<string, unknown> } }> = []
  let listed = [shapeView]

  beforeEach(() => {
    __resetNuxtImportsMocks()
    __setUser({ email: 'owner@example.test' })
    __setFetchUser(async () => {})
    calls.length = 0
    listed = [shapeView]
    vi.stubGlobal('$fetch', vi.fn(async (url: string, opts: { method?: string, body?: Record<string, unknown> } = {}) => {
      calls.push({ url, opts })
      if (url === '/api/shapes?mine=1') return listed
      if (opts.method === 'PUT') {
        const dryRun = url.endsWith('?dry_run=1')
        if (!dryRun) listed = [{ ...shapeView, digest: 'sha256:new0000000000000' }]
        return { saved: !dryRun, shape: { ...shapeView, digest: 'sha256:new0000000000000' }, replaced_digest: shapeView.digest, grants_losing_reuse: shapeView.bound_grants }
      }
      if (opts.method === 'DELETE') {
        listed = []
        return { removed: true, grants_losing_reuse: shapeView.bound_grants }
      }
      return {}
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists own shapes with operations, digest and bound grants', async () => {
    const wrapper = mount(ShapesPage, { global: { stubs } })
    await flushPromises()
    const row = wrapper.find('[data-shape-row="jev"]')
    expect(row.text()).toContain('jev')
    expect(row.text()).toContain('owner')
    expect(row.text()).toContain('executable jev')
    expect(row.text()).toContain('4f1c00000000')
    expect(row.text()).toContain('1 continuing')
    expect(row.text()).toContain('pod-1@example.test')
    expect(wrapper.find('[data-shape-details="jev"]').exists()).toBe(false)
    await row.find('[data-shape-toggle]').trigger('click')
    const details = wrapper.find('[data-shape-details="jev"]')
    expect(details.find('[data-shape-operation="ask"]').text()).toContain('Ask Jev a structured question')
    expect(details.find('[data-shape-grant="g-1"]').text()).toContain('operation ask · always')
    expect(details.find('a[href="/grants"]').exists()).toBe(true)
    await row.find('[data-shape-show-toml]').trigger('click')
    expect(wrapper.find('[data-shape-toml-row="jev"]').text()).toContain('schema = "openape-shapes/v1"')
  })

  it('previews with a dry run, warns about grants losing reuse, then publishes', async () => {
    const wrapper = mount(ShapesPage, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-shape-publish-button]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-shape-toml]').setValue(TOML)
    await wrapper.find('[data-shape-preview-button]').trigger('click')
    await flushPromises()
    expect(calls.at(-1)).toMatchObject({ url: '/api/shapes/jev?dry_run=1', opts: { method: 'PUT', body: { toml: TOML } } })
    const preview = wrapper.find('[data-shape-preview]')
    expect(preview.text()).toContain('Parsed cli jev · 1 operation · digest new000000000')
    expect(preview.find('[data-shape-preview-warning]').text()).toContain('1 continuing grant stops being reused')

    await wrapper.find('[data-shape-publish-button]').trigger('click')
    await flushPromises()
    expect(calls.map(call => call.url)).toContain('/api/shapes/jev')
    expect(calls.find(call => call.url === '/api/shapes/jev')?.opts).toMatchObject({ method: 'PUT', body: { toml: TOML } })
    expect(wrapper.find('[data-shapes-success]').text()).toContain('Shape jev published')
    expect(wrapper.find('[data-shape-row="jev"]').text()).toContain('new000000000')
  })

  it('shows the server error title and refuses a TOML without a cli id', async () => {
    const wrapper = mount(ShapesPage, { global: { stubs } })
    await flushPromises()
    await wrapper.find('[data-shape-toml]').setValue('schema = "openape-shapes/v1"\n')
    await wrapper.find('[data-shape-preview-button]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-shapes-error]').text()).toContain('[cli] table')
    expect(calls.some(call => call.opts.method === 'PUT')).toBe(false)

    ;(globalThis.$fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ data: { title: 'The shapes-registry already describes git; use or extend the registry shape' } })
    await wrapper.find('[data-shape-toml]').setValue('[cli]\nid = "git"\n')
    await wrapper.find('[data-shape-preview-button]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-shapes-error]').text()).toContain('already describes git')
  })

  it('removes a shape only after confirmation', async () => {
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmMock)
    const wrapper = mount(ShapesPage, { global: { stubs } })
    await flushPromises()
    await wrapper.find('[data-shape-remove]').trigger('click')
    await flushPromises()
    expect(confirmMock.mock.calls[0]![0 as never]).toContain('1 continuing grant on this digest stops being reused')
    expect(calls.some(call => call.opts.method === 'DELETE')).toBe(false)

    confirmMock.mockReturnValue(true)
    await wrapper.find('[data-shape-remove]').trigger('click')
    await flushPromises()
    expect(calls.find(call => call.opts.method === 'DELETE')?.url).toBe('/api/shapes/jev')
    expect(wrapper.find('[data-shapes-empty]').exists()).toBe(true)
  })
})
