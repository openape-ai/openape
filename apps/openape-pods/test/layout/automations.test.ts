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
import { domain } from '../renderer/decisions-inbox.test'
import { screenshotPath } from './evidence'

// Geometry of the Automatisierungen surface with the production stylesheet: the canvas height
// follows the content, the info panel moves below the map under 1000 px, dark mode uses tokens.
// Text and commands are asserted in test/renderer/automations-shell.test.ts.
const view = parseMapView(fixture) as MapView
// Every group becomes a tag of its Pods.
function tagged(): MapView {
  const copy = structuredClone(view)
  const tag = (group: string) => group.toLowerCase().replace(/\s+/g, '-')
  for (const pod of copy.pods) pod.tags = pod.group ? { own: [tag(pod.group)], revision: 1 } : undefined
  return parseMapView(copy)
}
const NOW = view.at + 11 * 60000
// Nodes ease towards their targets at 14 % per frame; 40 frames bring them within a pixel.
const frames = (count = 40) => new Promise<void>((done) => { const tick = (left: number) => left ? requestAnimationFrame(() => tick(left - 1)) : done(); tick(count) })
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en'); localStorage.clear() })
async function mountShell(width: number, height: number, dark = false, shown = view, mode: 'map' | 'list' = 'map') {
  await page.viewport(width, height)
  localStorage.setItem('pods.automations.mode', mode)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  applyLanguage('de')
  wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view: shown, live: false, now: NOW } })
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
    expect(full).toBeGreaterThan(geometry.firstRow + geometry.single.h + 2 * geometry.shared.layerHeight)
    expect(canvas().getBoundingClientRect().width).toBeGreaterThan(700)
    const info = document.querySelector('.automation-info')!.getBoundingClientRect()
    expect(info.width).toBe(300)
    expect(info.left).toBeGreaterThan(canvas().getBoundingClientRect().right)
    await shot('01-automatisierungen-karte')
    await shot('02-automatisierungen-karte-voll')
  })

  it('starts with the Pods without a tag, shows activated tags and relays out the map', async () => {
    await mountShell(1440, 1000, false, tagged())
    expect(canvas()).not.toBeNull()
    await shot('03-tags-ohne-tag')
    await wrapper!.findAll('button').find(item => item.text().startsWith('Ohne Tag'))!.trigger('click'); await flushPromises()
    expect(document.querySelector('.automations-empty')!.getBoundingClientRect().height).toBeGreaterThan(80)
    expect(canvas()).toBeNull()
    await shot('03-tags-leer')
    await button('Alle').trigger('click'); await flushPromises(); await frames()
    const full = canvas().height
    await button('Keine').trigger('click'); await flushPromises()
    await wrapper!.findAll('button').find(item => item.text().startsWith('#iurio'))!.trigger('click'); await flushPromises(); await frames()
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

  it('opens the detail drawer 520 px wide at the right edge with the shared data of a Pod', async () => {
    await mountShell(1440, 1000)
    const shell = wrapper!.vm as unknown as { open: (id: string | null) => void, pin: (id: string | null) => void }
    const classification = view.pods.find(pod => pod.name === 'Mail-Klassifizierung')!
    shell.pin(classification.id); shell.open(classification.id); await flushPromises(); await frames(5)
    const drawer = document.querySelector('.automation-detail')!.getBoundingClientRect()
    expect(drawer.width).toBe(520)
    expect(drawer.right).toBe(1440 - 16)
    expect(drawer.bottom).toBeLessThanOrEqual(1000)
    expect(document.querySelector('.automation-detail [data-shared]')!.textContent).toContain('delta-mind/mail/classifications')
    await shot('05-pod-detail-klassifizierung')
  })

  it('shows one row per Pod with purpose, state, result, next run and waits-for at 1280 and 390 px', async () => {
    const described = structuredClone(view)
    for (const item of described.pods) item.description = item.description ?? `${item.name}: liest neue Einträge und schreibt das Ergebnis in die gemeinsamen Daten.`
    for (const [width, height] of [[1280, 900], [390, 844]] as const) {
      await mountShell(width, height, false, parseMapView(described), 'list')
      const table = document.querySelector('.automations-list table')!
      expect(table.querySelectorAll('thead th')).toHaveLength(5)
      expect(document.querySelector('.automations-list tbody tr .automations-list-purpose')!.textContent).toContain('liest neue Einträge')
      expect(document.documentElement.scrollWidth, `${width}: page overflow`).toBeLessThanOrEqual(width)
      await shot(`15-zeilen-${width}`)
      await page.screenshot({ path: screenshotPath(`redesign-15-zeile-${width}.png`), element: document.querySelector<HTMLElement>('.automations-list tbody tr:nth-child(2)')! })
      wrapper!.unmount(); wrapper = undefined
    }
  })

  it('shows failed runs and a requested grant where the owner looks first, with one count in KPI, tab and Rechte', async () => {
    for (const [width, height] of [[1280, 900], [390, 844]] as const) {
      await mountShell(width, height, false, view, 'list')
      const errors = document.querySelector<HTMLElement>('[data-kpi="errors"]')!
      expect(errors.classList.contains('alert')).toBe(true)
      expect(errors.querySelector('b')!.textContent).toBe('140')
      const decisions = document.querySelector<HTMLElement>('[data-kpi="decisions"] b')!.textContent
      expect(document.querySelector('[role="tablist"] .n')!.textContent).toBe(decisions)
      // The failure count sits inside the result cell, below the last result, and wraps instead of widening the page.
      const row = Array.from(document.querySelectorAll<HTMLElement>('.automations-list tbody tr')).find(item => item.querySelector('b')!.textContent === 'IURIO PR monitor')!
      const cell = row.querySelector<HTMLElement>('.result-cell')!.getBoundingClientRect()
      const failures = row.querySelector<HTMLElement>('.result-cell .failures')!.getBoundingClientRect()
      expect(failures.height).toBeGreaterThan(0)
      expect(failures.top).toBeGreaterThanOrEqual(cell.top); expect(failures.bottom).toBeLessThanOrEqual(cell.bottom + 0.5)
      expect(getComputedStyle(row.querySelector('.result-cell .failures')!).color).toBe(getComputedStyle(document.querySelector('.state-chip[data-state="failing"]')!).color)
      await shot(`16-fehler-und-freigaben-${width}`)
      await page.screenshot({ path: screenshotPath(`redesign-16-kpi-${width}.png`), element: document.querySelector<HTMLElement>('.kpi-row')! })
      const task = Array.from(document.querySelectorAll<HTMLElement>('.automations-list tbody tr')).find(item => item.querySelector('b')!.textContent === 'IURIO Task monitor')!
      for (const [name, element] of [['pr-monitor', row], ['task-monitor', task]] as const) {
        element.scrollIntoView({ block: 'center' })
        await page.screenshot({ path: screenshotPath(`redesign-16-zeile-${name}-${width}.png`), element })
      }
      wrapper!.unmount()
      wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: false, now: NOW, desktop: true, tab: 'decisions', domain } })
      await flushPromises(); await frames(2)
      expect(document.querySelector('[role="tablist"] .n')!.textContent).toBe(decisions)
      const rights = document.querySelector<HTMLElement>('[data-testid="rights"]')!
      const grant = rights.querySelector<HTMLElement>('[data-right="grant"]')!
      expect(grant.getBoundingClientRect().right).toBeLessThanOrEqual(width)
      expect(grant.querySelector('button.idp')!.getBoundingClientRect().height).toBeGreaterThan(20)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
      rights.scrollIntoView({ block: 'center' })
      await page.screenshot({ path: screenshotPath(`redesign-17-rechte-${width}.png`), element: rights })
      wrapper!.unmount(); wrapper = undefined
    }
  })

  it('pins a Pod without drawing access labels over the map', async () => {
    const texts: string[] = []
    const original = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, maxWidth?: number) { texts.push(text); return original.call(this, text, x, y, maxWidth) }
    try {
      await mountShell(1440, 1000)
      const shell = wrapper!.vm as unknown as { pin: (id: string | null) => void }
      shell.pin(view.pods.find(pod => pod.name === 'Mail-Klassifizierung')!.id); await flushPromises()
      texts.length = 0; await frames(3)
      expect(texts.some(text => text.startsWith('Mail-Klass'))).toBe(true)
      expect(texts.filter(text => text.includes('24 h'))).toEqual([])
      await shot('06-karte-gepinnt-ohne-zugriffslabels')
    }
    finally { CanvasRenderingContext2D.prototype.fillText = original }
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
    wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: false, now: NOW, desktop: true, tab: 'decisions', domain } })
    await flushPromises(); await frames(2)
    const card = document.querySelector('[data-testid="questions"] .item')!.getBoundingClientRect()
    expect(card.width).toBeGreaterThan(1200)
    const facts = getComputedStyle(document.querySelector('[data-testid="questions"] .facts')!).gridTemplateColumns.split(' ')
    expect(facts).toHaveLength(4)
    await shot('10-entscheidungen')
    await (wrapper.find('.ctrls select') as unknown as { setValue: (value: string) => Promise<void> }).setValue('sender'); await flushPromises(); await frames(2)
    expect(document.querySelectorAll('.grp').length).toBeGreaterThan(5)
    await shot('11-entscheidungen-buendeln')
    await page.viewport(390, 844); await frames(2)
    expect(getComputedStyle(document.querySelector('[data-testid="questions"] .facts')!).gridTemplateColumns.split(' ')).toHaveLength(2)
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
