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

// Nuxt UI's color mode sets the theme class on mount, so the dark theme is applied just before capturing.
async function capture(name: string, dark = false) {
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.classList.toggle('light', !dark)
  for (const width of [1280, 390]) {
    await page.viewport(width, 1700)
    await frame()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    await page.screenshot({ path: shot(`${name}-${width}`) })
  }
}

beforeEach(() => { __resetNuxtImportsMocks() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.classList.remove('dark') })

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
  // A grant the requester resolved carries no program facts.
  expect(card.find('[data-version-untested]').exists()).toBe(false)
  await capture('git-push-requester-title')
})

it('shows the exact command and the claims for an unknown command', async () => {
  const card = await mountPage({ grant_id: 'grant-unknown' }, cardFixtures.unknown)
  expect(card.get('[data-binding-line="command"]').text()).toBe('acme-cli deploy --env production')
  await capture('unknown-command')
})

it('flags a program version the registry adapter was not tested with', async () => {
  const card = await mountPage({ grant_id: 'grant-git-untested' }, cardFixtures.gitUntested)
  expect(card.get('[data-binding-line="registry"]').text()).toBe('Push feature/rebase to origin')
  expect(card.get('[data-version-untested]').text()).toContain('Version not tested')
  await capture('git-untested-version-en')
})

it('flags an untested program version in German', async () => {
  const card = await mountPage({ grant_id: 'grant-git-untested' }, cardFixtures.gitUntested, 'de-AT')
  expect(card.get('[data-version-untested]').text()).toContain('Version nicht getestet')
  await capture('git-untested-version-de')
})

it('lists batch members by their binding line', async () => {
  const member = (grant: typeof cardFixtures.gitPush, id: string) => ({ ...grant, id, request: { ...grant.request, batch: { id: 'b-1', title: 'Rebase follow-up', size: 2 }, waits_until: Math.floor(Date.now() / 1000) + 600 } })
  const batch = await mountPage({ requester: cardFixtures.gitPush.request.requester, batch: 'b-1' }, { data: [member(cardFixtures.gitPush, 'g-1'), member(cardFixtures.unknown as typeof cardFixtures.gitPush, 'g-2')], pagination: { cursor: null, has_more: false } })
  expect(batch.findAll('[data-binding-line]').map(line => line.text())).toEqual(['acme-cli deploy --env production', 'Push feature/rebase to origin'])
  await capture('batch')
})

// Issue 1477: a command without a registry adapter, as the Pods graph gate requests it.
function gateMember(id: string, second: number, payload: Record<string, unknown>, title: string) {
  const { graphGate } = cardFixtures
  const [program, verb, json] = graphGate.request.command
  const command = [program!, verb!, JSON.stringify({ ...JSON.parse(json!), ...payload })]
  return { ...graphGate, id, created_at: graphGate.created_at + second, request: { ...graphGate.request, command, summary: { title }, batch: { id: 'b-gate', title: 'Newsletter, 15. Oktober', size: 3 }, waits_until: Math.floor(Date.now() / 1000) + 600 } }
}

function gateBatch() {
  return {
    data: [
      gateMember('g-1', 0, {}, '62 Personen haben sich Ihr Profil angesehen'),
      gateMember('g-2', 1, { hash: '0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c', object: 'phofmann@delta-mind.at:AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0Aihx0qtzv3k_XDmEEfSdYlgAJOdNU1xBB' }, 'Ihre Rechnung für Oktober'),
      gateMember('g-3', 2, { action: 'mail.keep', hash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b', object: 'phofmann@delta-mind.at:AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0Aihx0qtzv3k_XDmEEfSdYlgAJOdNU2yCC' }, 'Wochenrückblick'),
    ],
    pagination: { cursor: null, has_more: false },
  }
}

for (const dark of [false, true]) {
  const theme = dark ? '-dark' : ''
  for (const language of ['en-GB', 'de-AT']) {
    const lang = language.slice(0, 2)

    it(`shows a readable exact command on the card (${lang}${theme})`, async () => {
      const card = await mountPage({ grant_id: 'grant-graph-gate' }, cardFixtures.graphGate, language)
      expect(card.get('h2 [data-requester-headline]').text()).toBe('62 Personen haben sich Ihr Profil angesehen')
      expect(card.get('h2 [data-requested-marker]').text()).toBe(lang === 'de' ? 'laut Anfrage' : 'as requested')
      expect(card.find('[data-requester-claims]').exists()).toBe(false)
      expect(card.get('[data-command-head]').text()).toBe('pods-graph-gate approve')
      expect(card.get('[data-binding-line="command"]').text()).toContain('mail.archive')
      // Open the technical details with the raw command line.
      ;(card.get('[data-grant-card] > details').element as HTMLDetailsElement).open = true
      await frame()
      expect(card.get('[data-raw-command]').text()).toContain(cardFixtures.graphGate.request.command[2])
      await capture(`graph-gate-card-${lang}${theme}`, dark)
    })

    it(`lists graph gate batch members by their compact command line (${lang}${theme})`, async () => {
      const batch = await mountPage({ requester: cardFixtures.graphGate.request.requester, batch: 'b-gate' }, gateBatch(), language)
      const marker = lang === 'de' ? 'laut Anfrage' : 'as requested'
      expect(batch.findAll('[data-requester-headline]').map(headline => headline.text())).toEqual(['62 Personen haben sich Ihr Profil angesehen', 'Ihre Rechnung für Oktober', 'Wochenrückblick'].map(title => `${title}${marker}`))
      expect(batch.find('[data-row-claim]').exists()).toBe(false)
      expect(batch.findAll('[data-command-head]').map(head => head.text())).toEqual(['pods-graph-gate approve', 'pods-graph-gate approve', 'pods-graph-gate approve'])
      await capture(`graph-gate-batch-${lang}${theme}`, dark)
      // On a phone (the last capture): the head and two lines of facts; members that would
      // otherwise read the same show where they differ in one more line.
      const height = (id: string) => document.querySelector(`[data-batch-row="${id}"] [data-binding-line="command"]`)!.getBoundingClientRect().height
      expect(height('g-3')).toBeLessThanOrEqual(3 * 20 + 2)
      expect(Math.max(height('g-1'), height('g-2'))).toBeLessThanOrEqual(4 * 20 + 2)
    })

    it(`keeps decided members in a closed history below the open ones (${lang}${theme})`, async () => {
      const decided = (id: string, second: number, status: string, at: Record<string, number>, payload: Record<string, unknown>, title: string) => ({ ...gateMember(id, second, payload, title), status, ...at })
      const { data } = gateBatch()
      const mixed = [
        decided('g-0', -3, 'used', { decided_at: 1_791_960_100, used_at: 1_791_960_200 }, { object: 'phofmann@delta-mind.at:AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0Aihx0qtzv3k_XDmEEfSdYlgAJOdNU3zDD' }, 'Lieferung unterwegs'),
        decided('g-00', -2, 'denied', { decided_at: 1_791_960_300 }, { action: 'mail.delete' }, 'Gewinnspiel'),
        decided('g-000', -1, 'expired', {}, { action: 'mail.keep' }, 'Termin morgen'),
        ...data,
      ]
      const sized = mixed.map(member => ({ ...member, request: { ...member.request, batch: { ...member.request.batch, size: mixed.length } } }))
      const batch = await mountPage({ requester: cardFixtures.graphGate.request.requester, batch: 'b-gate' }, { data: sized, pagination: { cursor: null, has_more: false } }, language)
      expect(batch.findAll('[data-batch-rows] [data-batch-row]')).toHaveLength(3)
      expect(batch.find('[data-batch-history] summary').text()).toBe(lang === 'de' ? 'Bereits entschieden (3)' : 'Already decided (3)')
      await capture(`graph-gate-history-closed-${lang}${theme}`, dark)
      ;(batch.get('[data-batch-history]').element as HTMLDetailsElement).open = true
      await frame()
      expect(batch.findAll('[data-batch-history] [data-requester-headline]').map(headline => headline.text().replace(/(laut Anfrage|as requested)$/, ''))).toEqual(['Gewinnspiel', 'Lieferung unterwegs', 'Termin morgen'])
      expect(batch.findAll('[data-batch-history] [data-binding-line="command"]')).toHaveLength(3)
      await capture(`graph-gate-history-open-${lang}${theme}`, dark)
    })
  }
}
