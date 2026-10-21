import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { commands, page } from 'vitest/browser'
import type { Component } from 'vue'
import type { Inbox } from '../../app/inbox/client'
import { chooseLanguage } from '../../app/inbox/i18n'
import IndexPage from '../../app/pages/inbox/index.vue'
import ItemPage from '../../app/pages/inbox/item/[id].vue'
import MessagesPage from '../../app/pages/inbox/messages.vue'
import SettingsPage from '../../app/pages/inbox/settings.vue'
import { decision, installNuxtBoundary, NuxtLink, route, transport } from './fixture'

let inbox: Inbox
vi.mock('../../app/inbox/client', async original => ({ ...await original<typeof import('../../app/inbox/client')>(), useInbox: () => inbox }))
let wrapper: VueWrapper | undefined
beforeEach(async () => {
  chooseLanguage('de')
  document.documentElement.lang = 'de'
  installNuxtBoundary()
  Object.assign(route, { path: '/inbox/', params: {}, query: {} })
  await page.viewport(390, 844)
})
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined
  document.body.replaceChildren()
  document.documentElement.style.fontSize = ''
  document.body.style.fontSize = ''
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function settle() { await flushPromises(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) }
async function open(component: Component = IndexPage) {
  wrapper?.unmount()
  wrapper = mount(component, { attachTo: document.body, global: { components: { NuxtLink } } })
  await settle()
  return wrapper
}
async function click(name: string) { await page.getByRole('button', { name, exact: true }).click(); await settle() }
async function shot(name: string) {
  expect(document.documentElement.scrollWidth, 'No horizontal scrolling').toBeLessThanOrEqual(innerWidth)
  const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  await commands.captureInbox(`${name}-${theme}`)
}

it('presents sender, classification and tags with production styles at narrow and wide widths', async () => {
  const item = decision({ title: 'Ready to explore this?', body: 'Review uncertain mail · Synthetic company · Mail network\naccount: owner@pods-inbox.test\ncategory: newsletter\nconfidence: 0.87\nsender: news@example.com\nurgency: normal' })
  inbox = transport([item]).inbox
  await inbox.start(); await open()
  const card = wrapper!.get('li.inbox-card')
  expect(card.get('.sender').text()).toContain('news@example.com')
  expect(card.text()).toContain('newsletter · Sicherheit 87 %')
  expect(card.text()).not.toContain('Review uncertain mail')
  expect(card.get('.tags').text()).toBe('Tags: finanzen')
  expect(card.findAll('strong').map(node => node.text())).toEqual(['Absender: news@example.com', 'Ready to explore this?'])
  for (const width of [375, 390, 1280]) {
    await page.viewport(width, 844); await settle()
    const box = card.element.getBoundingClientRect()
    expect(box.width).toBeGreaterThan(300)
    expect(box.width).toBeLessThanOrEqual(608)
    expect(getComputedStyle(card.element).borderRadius).toBe('12px')
    expect(getComputedStyle(card.element).backgroundColor).toBe(matchMedia('(prefers-color-scheme: dark)').matches ? 'rgb(27, 34, 30)' : 'rgb(255, 255, 255)')
    expect(card.get('.sender').element.getBoundingClientRect().top).toBeLessThan(card.get('.title').element.getBoundingClientRect().top)
    for (const control of card.findAll('button, .quick-link')) expect(control.element.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await shot(`cards-${width}`)
  }
})

it('requires evidence and renders pending, accepted and applied as distinct states', async () => {
  const item = decision()
  const fixture = transport([item]); inbox = fixture.inbox
  await inbox.start()
  Object.assign(route, { path: `/inbox/item/${item.id}`, params: { id: item.id }, query: { option: 'seen' } })
  await open(ItemPage)
  expect(wrapper!.get('article .tags').text()).toBe('Tags: finanzen')
  await click('„Bereits zugestellt“ senden')
  expect(wrapper!.get('#decision-missing').text()).toBe('Bitte zuerst ausfüllen.')
  expect(fixture.requests).toHaveLength(0)
  await page.getByRole('textbox', { name: 'Was hast du festgestellt?' }).fill('Buchhaltung hat den Eingang telefonisch bestätigt.')
  expect(wrapper!.find('#decision-missing').exists()).toBe(false)
  await shot('evidence')
  await click('„Bereits zugestellt“ senden')
  expect(wrapper!.get('.decision [role=status]').text()).toContain('wird gleich gesendet')
  expect(fixture.requests).toHaveLength(0)
  await fixture.elapse(); await settle()
  expect(fixture.requests[0]!.body).toMatchObject({ option: 'seen', digest: item.decision!.digest, input: 'Buchhaltung hat den Eingang telefonisch bestätigt.' })
  expect(wrapper!.get('.decision [role=status]').text()).toContain('Angenommen: Bereits zugestellt. Wartet auf den Mac; noch nicht angewendet.')
  expect(wrapper!.find('.options').exists()).toBe(false)
  await shot('accepted')
  fixture.server.operation = 'applied'
  fixture.server.items = [{ ...item, state: 'resolved' }]
  await click('Status prüfen')
  expect(wrapper!.get('.decision [role=status]').text()).toBe('Angewendet: Bereits zugestellt.')
  expect(wrapper!.get('.inbox-done').text()).toBe('Erledigt. Diese Entscheidung wartet nicht mehr.')
  await shot('applied')
})

it('keeps cards fixed through undo, acceptance and incoming decisions until explicitly refreshed', async () => {
  const item = decision()
  const second = decision({ title: 'Second decision', sequence: 2 })
  const fixture = transport([item, second]); inbox = fixture.inbox
  await inbox.start(); await open()
  const positions = () => wrapper!.findAll('li.inbox-card').map(card => Math.round(card.element.getBoundingClientRect().top))
  const before = positions()
  const card = page.getByRole('listitem').filter({ hasText: item.title })
  await card.getByRole('button', { name: 'Erneut zustellen', exact: true }).click(); await settle()
  expect(positions()).toEqual(before)
  expect(wrapper!.get('.cover').text()).toContain('wird gleich gesendet')
  await click('Rückgängig'); await fixture.elapse(); await settle()
  expect(fixture.requests).toHaveLength(0)
  expect(positions()).toEqual(before)
  await card.getByRole('button', { name: 'Erneut zustellen', exact: true }).click(); await settle()
  await shot('undo')
  await fixture.elapse(); await settle()
  expect(wrapper!.get('.cover').text()).toContain('noch nicht angewendet')
  expect(getComputedStyle(wrapper!.get('.quick.covered').element).visibility).toBe('hidden')
  const incoming = decision({ title: 'Neue Mail während der Arbeit', sequence: 3 })
  fixture.server.items.push(incoming)
  await click('Aktualisieren')
  expect(positions()).toEqual(before)
  expect(wrapper!.text()).not.toContain(incoming.title)
  await shot('stable-cards')
  await click('1 neue anzeigen')
  expect(wrapper!.text()).toContain(incoming.title)
})

it('shows detail tags and safe external links without horizontal overflow', async () => {
  const item = decision({ kind: 'message', decision: null, title: 'Monatsabschluss bereit', read: 1, pod: { id: crypto.randomUUID(), name: 'Belege', tags: ['finanzen', 'monatsabschluss'] }, links: [{ title: 'Bericht öffnen', url: 'https://report.openape.ai/d/example' }] })
  inbox = transport([item]).inbox; await inbox.start()
  Object.assign(route, { path: `/inbox/item/${item.id}`, params: { id: item.id } })
  await open(ItemPage)
  expect(wrapper!.get('article .tags').text()).toBe('Tags: finanzen monatsabschluss')
  expect(wrapper!.get('.links a').attributes('rel')).toBe('noopener noreferrer')
  for (const width of [390, 1280]) {
    await page.viewport(width, 844); await settle()
    const article = wrapper!.get('article').element.getBoundingClientRect()
    for (const tag of wrapper!.findAll('article .tag')) {
      const box = tag.element.getBoundingClientRect()
      expect(box.left).toBeGreaterThanOrEqual(article.left)
      expect(box.right).toBeLessThanOrEqual(article.right)
      expect(getComputedStyle(tag.element).borderRadius).toBe('999px')
    }
    await shot(`detail-tags-${width}`)
  }
})

it('renders loading, empty and service errors with a working retry', async () => {
  const fixture = transport([]); inbox = fixture.inbox
  await open()
  // start() is asynchronous; explicitly hold this presentation state after mounting.
  inbox.state.phase = 'loading'; await settle()
  expect(wrapper!.get('[role=status]').text()).toBe('Lädt …')
  await shot('loading')
  await inbox.start(); await settle()
  expect(wrapper!.text()).toContain('Keine offenen Entscheidungen.')
  await shot('empty')
  fixture.server.fail = true
  await inbox.start(); await settle()
  expect(wrapper!.get('[role=alert]').text()).toContain('fixture_unavailable')
  expect(wrapper!.find('main').exists()).toBe(false)
  await shot('error')
  fixture.server.fail = false
  await click('Aktualisieren')
  expect(wrapper!.text()).toContain('Keine offenen Entscheidungen.')
})

it.each([375, 390])('keeps settings values and navigation readable with large text at %i px', async (width) => {
  await page.viewport(width, 844)
  inbox = transport([decision(), decision({ kind: 'message', decision: null })]).inbox; await inbox.start()
  route.path = '/inbox/settings'
  await open(SettingsPage)
  document.documentElement.style.fontSize = '28px'; document.body.style.fontSize = '28px'
  await settle()
  expect(Math.min(...wrapper!.findAll('dd').map(node => node.element.getBoundingClientRect().width))).toBeGreaterThan(300)
  for (const link of wrapper!.findAll('.inbox-tabs a')) {
    const box = link.element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(link.get('span:first-child').element)
    for (const line of range.getClientRects()) {
      expect(line.left).toBeGreaterThanOrEqual(box.left)
      expect(line.right).toBeLessThanOrEqual(box.right)
    }
  }
  await shot(`settings-large-text-${width}`)
  window.scrollTo(0, document.documentElement.scrollHeight); await settle()
  await shot(`settings-large-text-bottom-${width}`)
  expect(wrapper!.get('main > .inbox-muted').element.getBoundingClientRect().bottom).toBeLessThanOrEqual(wrapper!.get('.inbox-tabs').element.getBoundingClientRect().top)
})

it('swipes a single message to read or archive on touch and leaves vertical scrolling alone', async () => {
  const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const messages = Array.from({ length: 10 }, (_, index) => decision({ kind: 'message', decision: null, title: `Mitteilung ${index + 1}`, created: 1792051200000 - index * 60000 }))
  const fixture = transport(messages); inbox = fixture.inbox
  await inbox.start()
  Object.assign(route, { path: '/inbox/messages', params: {}, query: {} })
  await open(MessagesPage)
  const card = (title: string) => [...document.querySelectorAll<HTMLElement>('li.inbox-card')].find(node => node.textContent?.includes(title))
  const centre = (title: string): [number, number] => { const box = card(title)!.getBoundingClientRect(); return [box.left + box.width / 2, box.top + box.height / 2] }
  const drag = async (title: string, dx: number, dy = 0, screenshot?: string) => {
    const [x, y] = centre(title)
    await commands.touchDrag([x, y], [x + dx, y + dy], screenshot)
    await settle()
  }

  // A vertical drag over a card scrolls the page and changes nothing.
  await drag('Mitteilung 3', 0, -300)
  expect(scrollY).toBeGreaterThan(100)
  expect(fixture.requests).toHaveLength(0)
  expect(card('Mitteilung 3')!.style.transform).toBe('')
  scrollTo(0, 0); await settle()

  // A short swipe springs back without an action.
  await drag('Mitteilung 1', -50)
  expect(fixture.requests).toHaveLength(0)

  // Right to left marks only this message read.
  await drag('Mitteilung 1', -180, 0, `swipe-read-${theme}`)
  expect(fixture.requests).toEqual([{ path: expect.stringContaining(`/items/${messages[0]!.id}`), body: { read: true } }])
  expect(card('Mitteilung 1')!.classList.contains('unread')).toBe(false)
  expect(document.querySelectorAll('li.inbox-card.unread')).toHaveLength(9)

  // Left to right archives only this message; it leaves the inbox list.
  await drag('Mitteilung 2', 180, 0, `swipe-archive-${theme}`)
  expect(fixture.requests.at(-1)).toEqual({ path: expect.stringContaining(`/items/${messages[1]!.id}`), body: { archived: true } })
  expect(card('Mitteilung 2')).toBeUndefined()
  expect(document.querySelectorAll('li.inbox-card')).toHaveLength(9)
  expect(card('Mitteilung 3')!.classList.contains('unread')).toBe(true)
  await shot('swipe-after')
})
