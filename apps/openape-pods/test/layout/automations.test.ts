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
const NOW = view.at + 11 * 60000
// Nodes ease towards their targets at 14 % per frame; 40 frames bring them within a pixel.
const frames = (count = 40) => new Promise<void>((done) => { const tick = (left: number) => left ? requestAnimationFrame(() => tick(left - 1)) : done(); tick(count) })
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en') })
async function mountShell(width: number, height: number, dark = false) {
  await page.viewport(width, height)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  applyLanguage('de')
  wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: false, now: NOW, decisions: 17 } })
  await flushPromises(); await frames()
  return wrapper
}
const button = (text: string) => wrapper!.findAll('button').find(item => item.text().trim() === text)!
const canvas = () => document.querySelector('[data-testid="automations-map"] canvas') as HTMLCanvasElement
async function shot(name: string) { expect(document.documentElement.scrollWidth, `${name}: page overflow`).toBeLessThanOrEqual(innerWidth); await page.screenshot({ path: screenshotPath(`redesign-${name}.png`) }) }

describe('Automatisierungen layout', () => {
  it('sizes the canvas from its content and relays out a filtered group', async () => {
    await mountShell(1440, 1000)
    const full = canvas().height
    expect(full).toBeGreaterThan(geometry.firstRow + geometry.cluster.h + geometry.chain.h + geometry.single.h + geometry.collapsed.h)
    expect(canvas().getBoundingClientRect().width).toBeGreaterThan(700)
    const info = document.querySelector('.automation-info')!.getBoundingClientRect()
    expect(info.width).toBe(300)
    expect(info.left).toBeGreaterThan(canvas().getBoundingClientRect().right)
    await shot('01-automatisierungen-karte')
    await shot('02-automatisierungen-karte-voll')
    await button('iurio').trigger('click'); await flushPromises(); await frames()
    expect(canvas().height).toBe(geometry.columnStart + 4 * geometry.columnStep + 60)
    expect(canvas().height).toBeLessThan(full)
    await shot('03-gruppe-iurio')
    await button('Alle').trigger('click'); await flushPromises(); await frames()
    expect(canvas().height).toBe(full)
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
    shell.open(triage.collection!); await flushPromises(); await frames(5)
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
    expect(document.querySelectorAll('.app-settings-menu [data-switch]')).toHaveLength(2)
    await shot('09-einstellungen')
  })

  it('moves the info panel below the map under 1000 px and keeps the toolbar inside 390 px', async () => {
    await mountShell(390, 844)
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
    wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: false, now: NOW, desktop: true, tab: 'decisions', inbox: { choices, gates: [], graphGates: null, proposals: [] } } })
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
})
