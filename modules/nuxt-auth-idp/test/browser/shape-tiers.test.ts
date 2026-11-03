import ui from '@nuxt/ui/vue-plugin'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import GrantCard from '../../src/runtime/components/GrantCard.vue'
import ShapesPage from '../../src/runtime/pages/shapes.vue'
import type { GrantWithCard, OwnerShapeCard } from '../../src/runtime/utils/grant-card'
import { __resetNuxtImportsMocks } from '#imports'

// Shape tiers (issue 1553) with the IdP's real styles: the /shapes tabs and
// the grant card's tier marker, light and dark, wide and narrow.
// Screenshots go to .artifacts/shape-tiers/ for visual review.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const shot = (name: string) => `../../.artifacts/shape-tiers/${name}.png`
let wrapper: VueWrapper | undefined

const operations = [
  { id: 'deploy.run', command: ['run'], display: 'Deploy {service} to production', action: 'write', risk: 'high', resource_chain: [] },
  { id: 'deploy.status', command: ['status'], display: 'Show the deployment status', action: 'read', risk: 'low', resource_chain: [] },
]
const domainShape = { cli_id: 'deploy', executable: 'deploy', digest: 'SHA-256:7c1e9a0b44d2f3e1', toml: 'schema = "openape-shapes/v1"', description: '', operations, created_at: 1_793_000_000, published_at: 1_793_700_000, published_by: 'operator@delta-mind.example', bound_grants: [{ id: 'g-1', requester: 'release-agent+patrick+delta-mind_example@id.example', cli_id: 'deploy', operation_id: 'deploy.run', grant_type: 'always', decided_at: 1_793_710_000, digest_current: true }] }
const registryShape = { cli_id: 'git', executable: 'git', digest: 'SHA-256:a91f00c3d2b1e4f5', toml: null, description: 'Shapes adapter for git — declared options, read-only replay, exact rebase and push', operations: [operations[1]], created_at: 1_790_000_000, published_at: 1_793_600_000, published_by: null, bound_grants: [] }
const history = [
  { scope: 'domain', scope_key: 'delta-mind.example', action: 'update', cli_id: 'deploy', previous_digest: 'SHA-256:11aa22bb33cc44dd', digest: 'SHA-256:7c1e9a0b44d2f3e1', previous_toml: null, toml: null, source: { commit: '958d342e0f0a1b2c', dirty: false }, actor: 'operator@delta-mind.example', created_at: 1_793_700_000 },
  { scope: 'domain', scope_key: 'delta-mind.example', action: 'add', cli_id: 'deploy', previous_digest: null, digest: 'SHA-256:11aa22bb33cc44dd', previous_toml: null, toml: null, source: null, actor: 'admin@delta-mind.example', created_at: 1_793_000_000 },
]

function respond(url: string): unknown {
  if (url === '/api/shapes?mine=1') return []
  if (url === '/api/shapes?scope=domain') return [domainShape]
  if (url === '/api/shapes?scope=instance') return [registryShape]
  if (url.startsWith('/api/shapes/changes?scope=instance')) return [{ ...history[0], scope: 'instance', scope_key: '', cli_id: 'git', actor: '_management_' }]
  if (url.startsWith('/api/shapes/changes')) return history
  return {}
}

async function render(component: ReturnType<typeof defineComponent>, props: Record<string, unknown> = {}) {
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => respond(url)))
  const Root = defineComponent({ render: () => h('div', { class: 'bg-default text-default p-4' }, h(component, props)) })
  wrapper = mount(Root, { attachTo: document.body, global: { plugins: [ui] } })
  await flushPromises()
  await frame()
  return wrapper
}

async function capture(name: string) {
  for (const dark of [false, true]) {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.classList.toggle('light', !dark)
    for (const width of [1280, 390]) {
      await page.viewport(width, 1500)
      await document.fonts.ready
      await frame()
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
      await page.screenshot({ path: shot(`${name}-${dark ? 'dark' : 'light'}-${width}`) })
    }
  }
}

beforeEach(() => { __resetNuxtImportsMocks() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.classList.remove('dark', 'light') })

it('shows the domain tab with publishing and history for a domain admin', async () => {
  const shapes = await render(ShapesPage)
  await shapes.get('[data-shape-tab="domain"]').trigger('click')
  await flushPromises()
  await shapes.get('[data-shape-toggle]').trigger('click')
  await frame()
  expect(shapes.get('[data-shape-tab="domain"]').attributes('aria-selected')).toBe('true')
  expect(shapes.get('[data-shape-row="deploy"]').text()).toContain('by operator@delta-mind.example')
  expect(shapes.find('[data-shape-toml]').exists()).toBe(true)
  expect(shapes.findAll('[data-shape-change]')).toHaveLength(2)
  await capture('shapes-domain')
})

it('shows the IdP-wide tab read-only', async () => {
  const shapes = await render(ShapesPage)
  await shapes.get('[data-shape-tab="instance"]').trigger('click')
  await flushPromises()
  expect(shapes.find('[data-shape-toml]').exists()).toBe(false)
  expect(shapes.find('[data-shape-remove]').exists()).toBe(false)
  expect(shapes.get('[data-shape-change="git"]').text()).toContain('management token')
  await capture('shapes-instance')
})

it('marks a domain shape on the grant card with its domain, writer and the shape it replaces', async () => {
  const card: OwnerShapeCard = { cli_id: 'deploy', tier: 'domain', owner: null, domain: 'delta-mind.example', published_by: 'operator@delta-mind.example', overrides: 'instance', digest: domainShape.digest, published_at: domainShape.published_at, current: true, operation_id: 'deploy.run', operations }
  const grant = {
    id: 'grant-1',
    status: 'pending',
    created_at: 1_793_710_000,
    card: { registry: null, requester: { name: 'release-agent', owner: 'patrick@delta-mind.example' }, owner_shape: card },
    request: { requester: 'release-agent+patrick+delta-mind_example@id.example', target_host: 'macmini', audience: 'shapes', grant_type: 'always', authorization_details: [{ type: 'openape_cli', cli_id: 'deploy', operation_id: 'deploy.run', resource_chain: [], action: 'write', permission: 'deploy[]#write', display: 'Deploy to production', risk: 'high' }] },
  } as unknown as GrantWithCard
  const rendered = await render(GrantCard, { grant, german: false, technical: false })
  expect(rendered.get('[data-owner-shape]').text()).toContain('Domain shape of delta-mind.example')
  expect(rendered.get('[data-shape-overrides]').text()).toContain('Replaces the IdP-wide shape')
  await capture('grant-card-domain-shape')
})
