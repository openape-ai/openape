import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import type { PodsBridge } from '../../src/contracts/ipc'
import { installWorkspace, pods } from './workspace-fixture'

// Geometry formerly asserted by the packaged `pod-workspace`, `groups`,
// `language` and `foundation` E2E files. Screenshots keep the names that
// scripts/report.mjs embeds.
const tabs = {
  en: ['Overview', 'Chat', 'Script', 'Variables and secrets', 'Permissions', 'Settings', 'History'],
  de: ['Übersicht', 'Chat', 'Skript', 'Variablen und Geheimnisse', 'Berechtigungen', 'Einstellungen', 'Historie'],
}
// One size per breakpoint band (style.css: 1030, 900, 800, 760, 600) plus the
// shortest window. Colours come from light-dark() tokens and no rule depends on
// the scheme, so dark is measured once where space is tightest. German labels
// are longer, so they are measured where width is scarce.
const sizes = {
  en: [[1060, 850, 'light'], [880, 640, 'light'], [760, 700, 'light'], [560, 700, 'light'], [560, 560, 'dark']],
  de: [[880, 640, 'light'], [560, 560, 'dark']],
} as const
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const artifact = (name: string) => `../../.artifacts/${name}`
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en') })

async function mountWorkspace(overrides: Partial<PodsBridge> = {}) {
  installWorkspace(overrides)
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises(); await frame()
  return wrapper
}
async function show(width: number, height: number, scheme: 'light' | 'dark' = 'light') {
  await page.viewport(width, height)
  document.documentElement.style.colorScheme = scheme
  await frame()
}
async function click(selector: string, text?: string) {
  const target = text ? wrapper!.findAll(selector).find(item => item.text().trim() === text) : wrapper!.find(selector)
  if (!target?.exists()) throw new Error(`Missing ${selector} ${text ?? ''}`)
  await target.trigger('click'); await flushPromises(); await frame()
}
function overflow() {
  const content = document.querySelector('.content')!
  return {
    page: document.documentElement.scrollWidth - innerWidth,
    content: content.scrollWidth - content.clientWidth,
    footer: Math.round(document.querySelector('.workspace')!.getBoundingClientRect().bottom - innerHeight),
  }
}
const fits = { page: 0, content: expect.toSatisfy((value: number) => value <= 1), footer: expect.toSatisfy((value: number) => value <= 1) }

describe('workspace shell with the production stylesheet', () => {
  it.each(['en', 'de'] as const)('fits all seven views at desktop, compact and narrow sizes (%s)', async (language) => {
    applyLanguage(language)
    await mountWorkspace()
    // Guard against measuring an empty shell: the seeded pods must be rendered.
    expect(wrapper!.findAll('.pod-button').map(button => button.text())).toEqual([expect.stringContaining('Mail knowledge'), expect.stringContaining('Archived research')])
    for (const [width, height, scheme] of sizes[language]) {
      await show(width, height, scheme)
      for (const name of tabs[language]) {
        await click('[role="tab"]', name)
        expect(wrapper!.get('[role="tab"][aria-selected="true"]').text()).toBe(name)
        expect(overflow(), `${language} ${width}x${height} ${scheme} ${name}`).toEqual(fits)
        if (language === 'en' && ((width === 1060 && name === 'Overview') || (width === 560 && height === 700 && name === 'Permissions')))
          await page.screenshot({ path: artifact(`workspace-${width}-light-${name.toLowerCase()}.png`) })
      }
    }
  })

  it('shows the empty workspace in light, dark and the minimum compact window', async () => {
    await mountWorkspace({ workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: [] }) })
    expect(wrapper!.text()).toContain('No pods yet')
    for (const scheme of ['light', 'dark'] as const) {
      await show(1060, 850, scheme)
      expect(overflow(), scheme).toEqual(fits)
      await page.screenshot({ path: artifact(`foundation-${scheme}.png`) })
    }
    await show(880, 640)
    expect(overflow(), 'compact').toEqual(fits)
    await page.screenshot({ path: artifact('foundation-compact.png') })
  })

  it('keeps retained source evidence and the contextual chat inside a narrow dark window', async () => {
    await mountWorkspace()
    await click('button', 'Results and sources')
    await click('.knowledge-entry summary')
    await click('.knowledge-entry button')
    expect(wrapper!.get('.source-content').text()).toContain('Sent reply confirms Tuesday delivery.')
    await show(1060, 850)
    await page.screenshot({ path: artifact('workspace-source.png'), element: document.querySelector('.source-content')! })
    await show(560, 700, 'dark')
    expect(overflow(), 'source 560 dark').toEqual(fits)
    await click('button', 'Discuss knowledge')
    await show(1060, 850)
    expect(overflow(), 'chat').toEqual(fits)
    await page.screenshot({ path: artifact('workspace-master.png') })
  })

  it('saves settings and schedule panels as report evidence', async () => {
    await mountWorkspace()
    await show(1060, 850)
    await click('[role="tab"]', 'Settings')
    expect(overflow(), 'settings').toEqual(fits)
    await page.screenshot({ path: artifact('storage-settings.png') })
    await page.screenshot({ path: artifact('schedule-settings.png'), element: document.querySelector('.schedule-panel')! })
  })

  it('wraps a long group name inside the narrow sidebar instead of widening it', async () => {
    const longName = 'LongGroupName'.repeat(7)
    await mountWorkspace({ workspace: async () => ({ organization: { revision: 2, groups: [{ id: '00000000-0000-4000-8000-0000000000a1', name: longName, collapsed: false, podIds: [pods[0]!.id] }] }, pods: structuredClone(pods) }) })
    await show(560, 840, 'dark')
    const label = Array.from(document.querySelectorAll<HTMLElement>('.group-name')).find(element => element.textContent === longName)!
    expect(label.clientWidth).toBeGreaterThan(0)
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth)
    expect(overflow()).toEqual(fits)
    // Counter-check: without wrapping, the same label does overflow.
    label.style.overflowWrap = 'normal'
    expect(label.scrollWidth).toBeGreaterThan(label.clientWidth)
    label.style.removeProperty('overflow-wrap')
  })

  it('keeps the language switcher inside a narrow dark window', async () => {
    applyLanguage('de')
    await mountWorkspace()
    await show(560, 840, 'dark')
    await click('.nav-button[aria-label]')
    const select = document.querySelector<HTMLElement>('.language-control select')!
    expect(select.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(select.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth)
    expect(overflow()).toEqual(fits)
    select.style.minWidth = '1200px'
    expect(select.getBoundingClientRect().right).toBeGreaterThan(innerWidth)
    select.style.removeProperty('min-width')
  })
})
