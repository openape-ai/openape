import ui from '@nuxt/ui/vue-plugin'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { buildGenericResolvedServer } from '../../../../packages/grants/src/server-resolver'
import GrantApprovalPage from '../../src/runtime/pages/grant-approval.vue'
import GrantsPage from '../../src/runtime/pages/grants.vue'
import IdpPage from '../../src/runtime/components/Page.vue'
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
    await document.fonts.ready
    await frame()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    await page.screenshot({ path: shot(`${name}-${width}`) })
  }
}

beforeEach(() => { __resetNuxtImportsMocks() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.classList.remove('dark') })

it('renders the Pod run card from registry data', async () => {
  const card = await mountPage({ grant_id: 'grant-pod-run' }, cardFixtures.podRun)
  expect(card.get('[data-binding-line="registry"]').text()).toContain('Mail digest')
  // Show the environment variables the adapter keeps behind a disclosure.
  ;(card.get('[data-grant-card] details').element as HTMLDetailsElement).open = true
  await capture('pod-run-en')
})

it('renders the Pod run card in German', async () => {
  const card = await mountPage({ grant_id: 'grant-pod-run' }, cardFixtures.podRun, 'de-AT')
  expect(card.text()).toContain('Gespeichertes Pod-Skript ausführen')
  await capture('pod-run-de')
})

it('labels requester context and keeps the actual git authority visible', async () => {
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
  return { ...graphGate, card: { ...graphGate.card, requester: { name: 'Newsletter-Aufräumen', owner: 'owner@example.test' } }, id, created_at: graphGate.created_at + second, request: { ...graphGate.request, command, summary: { title, description: 'Review this individual message before approving the archive action.' }, batch: { id: 'b-gate', title: 'Newsletter, 15. Oktober', description: 'Drei Nachrichten einzeln prüfen und die ausgewählten archivieren.', size: 3 }, waits_until: Math.floor(Date.now() / 1000) + 600 } }
}

function gateBatch() {
  return {
    data: [
      gateMember('g-1', 0, {}, 'Produktneuigkeiten für Oktober'),
      gateMember('g-2', 1, { hash: '0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c', object: 'owner@example.test:synthetic-message-000000000000000000000000000000000000000000000000000002' }, 'Ihre Rechnung für Oktober'),
      gateMember('g-3', 2, { action: 'mail.keep', hash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b', object: 'owner@example.test:synthetic-message-000000000000000000000000000000000000000000000000000003' }, 'Wochenrückblick'),
    ],
    pagination: { cursor: null, has_more: false },
  }
}

for (const dark of [false, true]) {
  const theme = dark ? '-dark' : ''
  for (const language of ['en-GB', 'de-AT']) {
    const lang = language.slice(0, 2)

    it(`leads with context and discloses the complete exact command (${lang}${theme})`, async () => {
      const card = await mountPage({ grant_id: 'grant-graph-gate' }, cardFixtures.graphGate, language)
      expect(card.get('[data-requester-headline]').text()).toBe('Produktneuigkeiten für Oktober')
      expect((card.get('[data-grant-technical]').element as HTMLDetailsElement).open).toBe(false)
      expect(card.get('[data-requester-claims]').text()).toContain(lang === 'de' ? 'Beschreibung vom Antragsteller' : 'Description from the requester')
      expect(card.get('[data-command-head]').text()).toBe('pods-graph-gate approve')
      expect(card.get('[data-binding-line="command"]').text()).toContain('mail.archive')
      // Open the technical details with the raw command line.
      ;(card.get('[data-grant-technical]').element as HTMLDetailsElement).open = true
      await frame()
      expect(card.get('[data-raw-command]').text()).toContain(cardFixtures.graphGate.request.command[2])
      await capture(`graph-gate-card-${lang}${theme}`, dark)
    })

    it(`lists graph gate batch members with readable context and collapsed commands (${lang}${theme})`, async () => {
      const batch = await mountPage({ requester: cardFixtures.graphGate.request.requester, batch: 'b-gate' }, gateBatch(), language)
      expect(batch.findAll('[data-requester-headline]').map(headline => headline.text())).toEqual(['Produktneuigkeiten für Oktober', 'Ihre Rechnung für Oktober', 'Wochenrückblick'])
      expect(batch.find('[data-row-claim]').exists()).toBe(false)
      expect(batch.findAll('[data-command-head]').map(head => head.text())).toEqual(['pods-graph-gate approve', 'pods-graph-gate approve', 'pods-graph-gate approve'])
      await capture(`graph-gate-batch-${lang}${theme}`, dark)
      expect(batch.findAll('[data-grant-technical]').every(detail => !(detail.element as HTMLDetailsElement).open)).toBe(true)
      expect(document.querySelector('[data-command-head]')!.checkVisibility()).toBe(false)
    })

    it(`keeps decided members in a closed history below the open ones (${lang}${theme})`, async () => {
      const decided = (id: string, second: number, status: string, at: Record<string, number>, payload: Record<string, unknown>, title: string) => ({ ...gateMember(id, second, payload, title), status, ...at })
      const { data } = gateBatch()
      const mixed = [
        decided('g-0', -3, 'used', { decided_at: 1_791_960_100, used_at: 1_791_960_200 }, { object: 'owner@example.test:synthetic-message-000000000000000000000000000000000000000000000000000004' }, 'Lieferung unterwegs'),
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

it('renders protected exact-call decisions without a reusable approval control', async () => {
  const grant = structuredClone(cardFixtures.gitPush)
  Object.assign(grant.request.authorization_details[0]!, { cli_id: 'o365', operation_id: 'workflow.archive', action: 'move', display: 'Archive the reviewed message', constraints: { exact_command: true, single_use: true } })
  grant.request.command = ['o365-cli', 'workflow', 'archive', '--account', 'owner@example.test', '--message', 'synthetic-message', '--content-version', `content-v2:${'a'.repeat(64)}`, '--destination', 'archive']
  grant.request.execution_context.argv = grant.request.command
  grant.card.registry.title = { de: 'Geprüfte Nachricht archivieren', en: 'Archive the reviewed message' }
  grant.card.registry.allows = { de: 'Verschiebt genau diese geprüfte Nachricht einmal ins Archiv.', en: 'Moves this exact reviewed message to the archive once.' }
  grant.card.registry.does_not_allow = { de: 'Gilt nicht für andere Nachrichten oder geänderte Inhalte.', en: 'Does not cover other messages or changed content.' }
  grant.card.registry.facts = [{ label: { de: 'Postfach', en: 'Mailbox' }, value: 'owner@example.test', format: 'code', provenance: 'bound' }]
  grant.request.summary = { title: 'Synthetic newsletter', description: 'Script-provided context', origin: 'External mail recipe', link: 'https://example.test/review' }
  const card = await mountPage({ grant_id: grant.id }, grant, 'de-AT')
  expect(card.get('[data-binding-line]').text()).toBe('Geprüfte Nachricht archivieren')
  expect(card.text()).not.toContain('Immer erlauben')
  expect(card.text()).toContain('Script-provided context')
  await capture('protected-once-de')
})

it('shows the saved script context and opens its complete file bindings with the keyboard', async () => {
  const source = cardFixtures.unknown
  const command = ['OpenApe Pods', '/Applications/OpenApe Pods.app/runtime/script-entry.mjs', '--input-channel', '/Users/demo/Pods/script-artifacts/selected-script.mjs', '', 'c'.repeat(64)]
  const resolved = await buildGenericResolvedServer('OpenApe Pods', command)
  const script = {
    ...source,
    id: 'saved-script',
    card: { ...source.card, requester: { name: 'Morgenbriefing', owner: 'owner@example.test' }, program: { sha256: 'b'.repeat(64), version_tested: null } },
    request: {
      ...source.request,
      requester: 'morning-briefing@pods.example.test',
      grant_type: 'always',
      summary: { title: 'Morgenbriefing vorbereiten', description: 'Prüft Nachrichten und bereitet die tägliche Zusammenfassung vor.' },
      command,
      permissions: [resolved.detail.permission],
      authorization_details: [resolved.detail],
      execution_context: { ...resolved.executionContext, program_sha256: 'b'.repeat(64), files: [{ path: '/Applications/OpenApe Pods.app/runtime/script-entry.mjs', sha256: 'a'.repeat(64) }, { path: '/Users/demo/Pods/script-artifacts/selected-script.mjs', sha256: 'c'.repeat(64) }] },
    },
  }
  const card = await mountPage({ grant_id: script.id }, script, 'de-AT')
  expect(card.get('[data-requester-headline]').text()).toBe('Morgenbriefing vorbereiten')
  expect(card.get('[data-requester-identity]').text()).toContain('Morgenbriefing')
  expect(card.get('[data-requester-identity]').text()).toContain('morning-briefing@pods.example.test')
  expect(card.get('[data-bound-scope]').text()).toContain('2 gebundenen Dateien')
  expect((card.get('[data-grant-technical]').element as HTMLDetailsElement).open).toBe(false)
  expect(card.find('[data-broader-permission]').exists()).toBe(false)
  await capture('saved-script-collapsed-de')
  ;(card.get('[data-grant-technical] summary').element as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await frame()
  expect((card.get('[data-grant-technical]').element as HTMLDetailsElement).open).toBe(true)
  expect(card.get('[data-bound-files]').text()).toContain('/Users/demo/Pods/script-artifacts/selected-script.mjs')
  expect(card.get('[data-bound-files]').text()).toContain('c'.repeat(64))
  await capture('saved-script-details-de')
})

it('preselects ninety minutes while showing the real origin and method boundary', async () => {
  const source = cardFixtures.unknown
  const permission = 'pod-http.https-origin[url=https://tasks.example.test].http-method[name=POST]#request'
  const http = {
    ...source,
    id: 'http-request',
    brokered: { connection_id: 'connection-1', broker_issuer: 'https://pods.example.test', agent_issuer: 'https://pods.example.test', owner: 'owner@example.test', key_id: 'agent-key' },
    card: { ...source.card, binds_exact_command: false, requester: { name: 'Morgenbriefing', owner: 'owner@example.test' } },
    request: {
      ...source.request,
      grant_type: 'timed',
      duration: 5400,
      summary: { title: 'Briefing übermitteln', description: 'Die Zusammenfassung im Aufgabendienst ablegen.' },
      command: ['pod-http', 'request', '--origin', 'https://tasks.example.test', '--method', 'POST'],
      permissions: [permission],
      authorization_details: [{ type: 'openape_cli', cli_id: 'pod-http', operation_id: 'request', action: 'request', permission, display: 'HTTP POST to https://tasks.example.test', risk: 'high', resource_chain: [{ resource: 'https-origin', selector: { url: 'https://tasks.example.test' } }, { resource: 'http-method', selector: { name: 'POST' } }] }],

    },
  }
  const card = await mountPage({ grant_id: http.id }, http, 'de-AT')
  expect(card.get('input[type="number"]').element).toHaveProperty('value', '90')
  expect(card.get('[data-validity-control]').text()).toContain('1 h 30 min')
  expect(card.get('[data-bound-scope]').text()).toContain('POST → https://tasks.example.test')
  expect(card.get('[data-bound-scope]').text()).toContain('nicht an diese Freigabe gebunden')
  expect(card.find('[data-broader-permission]').exists()).toBe(false)
  await capture('http-timed-de')
})

it('keeps broader scope opt-in and performs no write when its disclosure opens', async () => {
  const source = cardFixtures.gitPush
  const original = source.request.authorization_details[0]!
  const wider = { ...original, resource_chain: [{ resource: 'repo' }, { resource: 'remote' }], permission: 'git.repo[*].remote[*]#push' }
  const grant = { ...source, widening_suggestions: [[{ scope: 'exact', label: 'Only origin', permission: original.permission, detail: original }, { scope: 'wildcard', label: 'All remotes', permission: wider.permission, detail: wider }]] }
  const card = await mountPage({ grant_id: grant.id }, grant, 'de-AT')
  const fetch = vi.mocked(globalThis.$fetch)
  const writes = () => fetch.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET')
  expect((card.get('[data-broader-permission]').element as HTMLDetailsElement).open).toBe(false)
  ;(card.get('[data-broader-permission] summary').element as HTMLElement).focus()
  await userEvent.keyboard('{Enter}'); await frame()
  expect((card.get('input[value="exact"]').element as HTMLInputElement).checked).toBe(true)
  expect((card.get('input[value="suggestion"]').element as HTMLInputElement).checked).toBe(false)
  expect(writes()).toHaveLength(0)
  await card.get('input[value="suggestion"]').setValue()
  await frame()
  expect(card.text()).toContain('All remotes')
  expect(writes()).toHaveLength(0)
  await capture('available-broader-scope-de')
})

it('uses the same content hierarchy in the pending list with the actual page scaffold', async () => {
  const source = cardFixtures.gitPush
  __setRouteQuery({})
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-AT')
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.includes('section=active') ? { data: [source] } : url.includes('section=history') ? { data: [] } : source))
  const Root = defineComponent({ render: () => h('div', { class: 'bg-default text-default' }, h(GrantsPage)) })
  wrapper = mount(Root, { attachTo: document.body, global: { plugins: [ui], components: { IdpPage } } })
  await flushPromises(); await frame()
  expect(wrapper.get('[data-requester-headline]').text()).toBe('Read-only status check')
  expect(wrapper.get('[data-requester-identity]').text()).toContain('IURIO rebase')
  expect(wrapper.get('[data-requester-identity]').text()).toContain(source.request.requester)
  expect(wrapper.get('[data-bound-scope]').text()).toContain('Schreibt auf den Server')
  expect((wrapper.get('[data-grant-technical]').element as HTMLDetailsElement).open).toBe(false)
  await capture('pending-list-de')
})

it('keeps new cross-run requests unselected after an explicit refresh', async () => {
  const first = { ...cardFixtures.gitPush, id: 'cross-run-1', status: 'pending', request: { ...cardFixtures.gitPush.request, grant_type: 'once', batch: { id: 'cross-run', title: 'Gemeinsam prüfen' } } }
  const batch = await mountPage({ requester: first.request.requester, batch: 'cross-run' }, { data: [first], pagination: { cursor: null, has_more: false } }, 'de-AT')
  const second = { ...first, id: 'cross-run-2', request: { ...first.request, summary: { title: 'Neu eingegangene Anfrage', description: 'Diese Anfrage wurde nach dem ersten Laden eingereicht.' } } }
  vi.stubGlobal('$fetch', vi.fn(async (_url: string, opts: { query?: { section?: string } }) => ({ data: opts.query?.section === 'history' ? [] : [first, second], pagination: { cursor: null, has_more: false } })))
  await batch.find('[data-batch-refresh]').trigger('click')
  await flushPromises()
  expect((batch.find('[data-batch-row="cross-run-1"] input').element as HTMLInputElement).checked).toBe(true)
  expect((batch.find('[data-batch-row="cross-run-2"] input').element as HTMLInputElement).checked).toBe(false)
  expect(batch.text()).toContain('1 ausgewählte freigeben, 1 ablehnen')
  await capture('cross-run-refresh-de')
  await capture('cross-run-refresh-de-dark', true)
})

it('shows request dates for cross-run groups, single-member groups and individual grants', async () => {
  const oldest = Date.parse('2026-10-18T08:15:00Z') / 1000
  const newest = Date.parse('2026-10-20T10:49:00Z') / 1000
  const first = { ...gateMember('date-first', 0, {}, 'Earlier request'), created_at: oldest }
  const last = { ...gateMember('date-last', 0, {}, 'Latest request'), created_at: newest }
  const one = { ...gateMember('date-only', 0, {}, 'Only request'), created_at: oldest, request: { ...first.request, batch: { id: 'date-only', title: 'Single pending request' } } }
  const single = { ...cardFixtures.gitPush, created_at: newest }
  __setRouteQuery({})
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-AT')
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.includes('section=active') ? { data: [last, one, first, single] } : url.includes('section=history') ? { data: [] } : single))
  const Root = defineComponent({ render: () => h('div', { class: 'bg-default text-default' }, h(GrantsPage)) })
  wrapper = mount(Root, { attachTo: document.body, global: { plugins: [ui], components: { IdpPage } } })
  await flushPromises(); await frame()
  const batches = wrapper.findAll('[data-pending-batch]')
  expect(batches[0]!.findAll('time').map(time => time.attributes('datetime'))).toEqual(['2026-10-18T08:15:00.000Z', '2026-10-20T10:49:00.000Z'])
  expect(batches[0]!.text()).toContain('Älteste offene Anfrage')
  expect(batches[0]!.text()).toContain('Neueste offene Anfrage')
  expect(batches[1]!.findAll('time')).toHaveLength(1)
  expect(batches[1]!.text()).toContain('Angefragt am')
  expect(wrapper.get('[data-grant-card] time').attributes('datetime')).toBe('2026-10-20T10:49:00.000Z')
  await capture('grant-request-dates-de')
  await capture('grant-request-dates-de-dark', true)
})
