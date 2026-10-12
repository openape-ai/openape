import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import AutomationsShell from '../../src/renderer/central/AutomationsShell.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { colorResolver, geometry } from '../../src/renderer/utils/automation-layout'
import fixture from '../renderer/map-view.json'
import { choices } from '../renderer/decisions-inbox.test'
import { screenshotPath } from './evidence'

// Geometry of the Automatisierungen surface with the production stylesheet: the canvas height
// follows the content, the info panel moves below the map under 1000 px, dark mode uses tokens.
// Text and commands are asserted in test/renderer/automations-shell.test.ts.
const view = parseMapView(fixture) as MapView
// Every group becomes a tag; network members inherit their network's tags.
function tagged(): MapView {
  const copy = structuredClone(view)
  const tag = (group: string | null) => (group ?? 'privat').toLowerCase().replace(/\s+/g, '-')
  for (const automation of copy.automations) automation.tags = { own: [tag(automation.group)], inherited: [], revision: 1 }
  for (const pod of copy.pods) {
    const network = copy.automations.find(automation => automation.members.includes(pod.id))
    pod.tags = network ? { own: [], inherited: network.tags!.own, revision: 0 } : pod.group ? { own: [tag(pod.group)], inherited: [], revision: 1 } : undefined
  }
  return parseMapView(copy)
}
const NOW = view.at + 11 * 60000
// Nodes ease towards their targets at 14 % per frame; 40 frames bring them within a pixel.
const frames = (count = 40) => new Promise<void>((done) => { const tick = (left: number) => left ? requestAnimationFrame(() => tick(left - 1)) : done(); tick(count) })
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en'); localStorage.clear() })
async function mountShell(width: number, height: number, dark = false, shown = view) {
  await page.viewport(width, height)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  applyLanguage('de')
  wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view: shown, live: false, now: NOW, decisions: 17 } })
  await flushPromises(); await frames()
  return wrapper
}
const button = (text: string) => wrapper!.findAll('button').find(item => item.text().trim() === text)!
const canvas = () => document.querySelector('[data-testid="automations-map"] canvas') as HTMLCanvasElement
async function shot(name: string) { expect(document.documentElement.scrollWidth, `${name}: page overflow`).toBeLessThanOrEqual(innerWidth); await page.screenshot({ path: screenshotPath(`redesign-${name}.png`) }) }

describe('Automatisierungen layout', () => {
  it('sizes the canvas from its content and places the info panel beside it', async () => {
    await mountShell(1440, 1000)
    const full = canvas().height
    expect(full).toBeGreaterThan(geometry.firstRow + geometry.cluster.h + geometry.single.h + geometry.collapsed.h)
    expect(canvas().getBoundingClientRect().width).toBeGreaterThan(700)
    const info = document.querySelector('.automation-info')!.getBoundingClientRect()
    expect(info.width).toBe(300)
    expect(info.left).toBeGreaterThan(canvas().getBoundingClientRect().right)
    await shot('01-automatisierungen-karte')
    await shot('02-automatisierungen-karte-voll')
  })

  it('starts empty with tags, shows activated tags and relays out the map', async () => {
    await mountShell(1440, 1000, false, tagged())
    expect(document.querySelector('.automations-empty')!.getBoundingClientRect().height).toBeGreaterThan(80)
    expect(canvas()).toBeNull()
    await shot('03-tags-leer')
    await button('Alle').trigger('click'); await flushPromises(); await frames()
    const full = canvas().height
    await button('Keine').trigger('click'); await flushPromises()
    await wrapper!.findAll('button').find(item => item.text().startsWith('#iurio'))!.trigger('click'); await flushPromises(); await frames()
    // Only IURIO Pods remain, so Telegram is written and no longer read: four rows in the side columns.
    expect(canvas().height).toBe(geometry.columnStart + 3 * geometry.columnStep + 60)
    expect(canvas().height).toBeLessThan(full)
    await shot('03-tag-iurio')
    await wrapper!.findAll('button').find(item => item.text().startsWith('#linde'))!.trigger('click'); await flushPromises(); await frames()
    await shot('03-tags-iurio-linde')
    await document.querySelector<HTMLElement>('.layers-menu summary')!.click(); await flushPromises()
    expect(document.querySelector('.layers-menu .layers')!.getBoundingClientRect().right).toBeLessThanOrEqual(1440)
    await shot('03-ebenen-menue')
    // Choosing a layer keeps the menu open; a press anywhere else closes it.
    document.querySelector<HTMLElement>('.layers-menu .lay')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(document.querySelector<HTMLDetailsElement>('.layers-menu')!.open).toBe(true)
    canvas().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(document.querySelector<HTMLDetailsElement>('.layers-menu')!.open).toBe(false)
    await button('Liste').trigger('click'); await flushPromises()
    expect(document.querySelector('.automations-list')!.getBoundingClientRect().width).toBeGreaterThan(1000)
    await shot('04-liste')
  })

  it('opens the detail drawer 520 px wide at the right edge and a network with its members', async () => {
    await mountShell(1440, 1000)
    const shell = wrapper!.vm as unknown as { open: (id: string | null) => void, pin: (id: string | null) => void }
    const triage = view.pods.find(pod => pod.name === 'Triage')!
    shell.pin(triage.id); shell.open(triage.id); await flushPromises(); await frames(5)
    const drawer = document.querySelector('.automation-detail')!.getBoundingClientRect()
    expect(drawer.width).toBe(520)
    expect(drawer.right).toBe(1440 - 16)
    expect(drawer.bottom).toBeLessThanOrEqual(1000)
    await shot('05-pod-detail-triage')
    shell.open(triage.automation!); await flushPromises(); await frames(5)
    expect(document.querySelectorAll('.automation-detail .members button')).toHaveLength(11)
    await shot('06-netz-detail')
  })

  it('shows the Codex handoff with the brief above the map', async () => {
    await mountShell(1440, 900)
    await wrapper!.setProps({ codex: 'connected' })
    const shell = wrapper!.vm as unknown as { pin: (id: string | null) => void }
    shell.pin('app:o365-cli:phofmann@delta-mind.at'); await flushPromises()
    await button('Neue Automatisierung mit Codex').trigger('click'); await flushPromises(); await frames(2)
    const panel = document.querySelector('.codex-handoff')!.getBoundingClientRect(); const map = canvas().getBoundingClientRect()
    expect(panel.bottom).toBeLessThanOrEqual(map.top)
    expect(panel.width).toBeGreaterThan(1200)
    await shot('08-codex-uebergabe')
  })

  it('opens the settings as a gear menu at the top right', async () => {
    await mountShell(1440, 900)
    await button('⚙ Einstellungen').trigger('click'); await flushPromises(); await frames(2)
    const menu = document.querySelector('.app-settings-menu')!.getBoundingClientRect()
    expect(menu.width).toBe(380)
    expect(menu.right).toBe(1440 - 16)
    expect(document.querySelectorAll('.app-settings-menu [data-account]')).toHaveLength(3)
    expect(document.querySelectorAll('.app-settings-menu [data-switch]')).toHaveLength(0)
    expect(document.querySelector('.app-settings-menu [data-mcp]')!.getBoundingClientRect().right).toBeLessThanOrEqual(1440 - 16)
    await shot('09-einstellungen')
  })

  it('moves the info panel below the map under 1000 px and keeps the toolbar inside 390 px', async () => {
    await mountShell(390, 844, false, tagged())
    expect(document.querySelector('.automations-tags')!.getBoundingClientRect().right).toBeLessThanOrEqual(390)
    await button('Alle').trigger('click'); await flushPromises(); await frames()
    const map = canvas().getBoundingClientRect(); const info = document.querySelector('.automation-info')!.getBoundingClientRect()
    expect(info.top).toBeGreaterThanOrEqual(map.bottom)
    expect(map.width).toBeLessThanOrEqual(390)
    expect(document.querySelector('.automations-toolbar')!.getBoundingClientRect().right).toBeLessThanOrEqual(390)
    await shot('12-mobil-karte')
  })

  it('lists the decisions full width with two-column facts, groups by sender and stacks at 390 px', async () => {
    await mountShell(1440, 1000)
    wrapper!.unmount()
    applyLanguage('de')
    wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: false, now: NOW, desktop: true, tab: 'decisions', inbox: { choices, gates: [] } } })
    await flushPromises(); await frames(2)
    const card = document.querySelector('[data-testid="choices"] .item')!.getBoundingClientRect()
    expect(card.width).toBeGreaterThan(1200)
    const facts = getComputedStyle(document.querySelector('[data-testid="choices"] .facts')!).gridTemplateColumns.split(' ')
    expect(facts).toHaveLength(4)
    await shot('10-entscheidungen')
    await (wrapper.find('.ctrls select') as unknown as { setValue: (value: string) => Promise<void> }).setValue('sender'); await flushPromises(); await frames(2)
    expect(document.querySelectorAll('.grp').length).toBeGreaterThan(5)
    await shot('11-entscheidungen-buendeln')
    await page.viewport(390, 844); await frames(2)
    expect(getComputedStyle(document.querySelector('[data-testid="choices"] .facts')!).gridTemplateColumns.split(' ')).toHaveLength(2)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await shot('13-mobil-entscheidungen')
  })

  it('renders the dark scheme from tokens', async () => {
    await mountShell(1440, 1000, true)
    // Canvas needs resolved colours; the probe turns a light-dark() token into the scheme's rgb value.
    const resolve = colorResolver(document.body)
    expect(resolve('--surface')).toMatch(/^rgb\(/)
    expect(resolve('--surface')).not.toBe('rgb(255, 255, 255)')
    const pixel = canvas().getContext('2d')!.getImageData(geometry.systemX, geometry.columnStart, 1, 1).data
    expect(pixel[3]).toBeGreaterThan(0)
    const background = getComputedStyle(document.querySelector('.kpi')!).backgroundColor
    expect(background).not.toBe('rgb(255, 255, 255)')
    await shot('14-dunkel-karte')
  })

  it('shows the secret form with its three ways inside the detail drawer', async () => {
    await mountShell(1440, 1000)
    const shell = wrapper!.vm as unknown as { open: (id: string | null) => void }
    const bot = view.pods.find(pod => pod.name === 'Morgenbriefing · Calendar-Bot')!
    shell.open(bot.id); await flushPromises(); await frames(5)
    await button('+ Geheimnis').trigger('click'); await flushPromises(); await frames(2)
    await wrapper!.findAll('[data-testid="secret-form"] .seg button')[2]!.trigger('click'); await flushPromises(); await frames(2)
    const drawer = document.querySelector('.automation-detail')!.getBoundingClientRect()
    const form = document.querySelector('[data-testid="secret-form"]')!.getBoundingClientRect()
    expect(form.left).toBeGreaterThanOrEqual(drawer.left); expect(form.right).toBeLessThanOrEqual(drawer.right)
    expect(document.querySelectorAll('[data-testid="secret-form"] .seg button')).toHaveLength(3)
    document.querySelector('[data-testid="secret-form"]')!.scrollIntoView({ block: 'center' })
    await shot('07-geheimnis-anfrage')
  })
})
