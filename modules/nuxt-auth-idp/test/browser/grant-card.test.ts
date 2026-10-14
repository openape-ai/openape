import ui from '@nuxt/ui/vue-plugin'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import GrantApprovalPage from '../../src/runtime/pages/grant-approval.vue'
import cardFixtures from '../fixtures/grant-cards.json'
import { __resetNuxtImportsMocks, __setRouteQuery } from '#imports'

// The generic approval card rendered with the IdP's real styles from registry
// fixtures (test/fixtures/grant-cards.json, checked against the adapters in
// grant-card.test.ts). Screenshots go to .artifacts/ for visual review.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const shot = (name: string) => `../../.artifacts/grant-card/${name}.png`
let wrapper: VueWrapper | undefined

async function mountPage(query: Record<string, string>, response: unknown, language = 'en-GB') {
  __setRouteQuery(query)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(language)
  vi.stubGlobal('$fetch', vi.fn(async () => response))
  const Root = defineComponent({ render: () => h('div', { class: 'bg-default text-default' }, h(GrantApprovalPage)) })
  wrapper = mount(Root, { attachTo: document.body, global: { plugins: [ui] } })
  await flushPromises()
  await frame()
  return wrapper
}

async function capture(name: string) {
  for (const width of [1280, 390]) {
    await page.viewport(width, 1700)
    await frame()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    await page.screenshot({ path: shot(`${name}-${width}`) })
  }
}

beforeEach(() => { __resetNuxtImportsMocks() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('renders the Pod run card from registry data', async () => {
  const card = await mountPage({ grant_id: 'grant-pod-run' }, cardFixtures.podRun)
  expect(card.get('[data-binding-line="registry"]').text()).toBe('Mail digest')
  // Show the environment variables the adapter keeps behind a disclosure.
  ;(card.get('[data-grant-card] details').element as HTMLDetailsElement).open = true
  await capture('pod-run-en')
})

it('renders the Pod run card in German', async () => {
  const card = await mountPage({ grant_id: 'grant-pod-run' }, cardFixtures.podRun, 'de-AT')
  expect(card.text()).toContain('Gespeichertes Pod-Skript ausführen')
  await capture('pod-run-de')
})

it('keeps the binding line of a git push above a misleading requester title', async () => {
  const card = await mountPage({ grant_id: 'grant-git-push' }, cardFixtures.gitPush)
  expect(card.get('[data-binding-line]').text()).toBe('Push feature/rebase to origin')
  expect(card.get('[data-requester-claims]').text()).toContain('Read-only status check')
  await capture('git-push-requester-title')
})

it('shows the exact command and the claims for an unknown command', async () => {
  const card = await mountPage({ grant_id: 'grant-unknown' }, cardFixtures.unknown)
  expect(card.get('[data-binding-line="command"]').text()).toBe('acme-cli deploy --env production')
  await capture('unknown-command')
})

it('lists batch members by their binding line', async () => {
  const member = (grant: typeof cardFixtures.gitPush, id: string) => ({ ...grant, id, request: { ...grant.request, batch: { id: 'b-1', title: 'Rebase follow-up', size: 2 }, waits_until: Math.floor(Date.now() / 1000) + 600 } })
  const batch = await mountPage({ requester: cardFixtures.gitPush.request.requester, batch: 'b-1' }, { data: [member(cardFixtures.gitPush, 'g-1'), member(cardFixtures.unknown as typeof cardFixtures.gitPush, 'g-2')], pagination: { cursor: null, has_more: false } })
  expect(batch.findAll('[data-binding-line]').map(line => line.text())).toEqual(['acme-cli deploy --env production', 'Push feature/rebase to origin'])
  await capture('batch')
})
