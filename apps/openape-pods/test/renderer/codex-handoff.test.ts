import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import AutomationsShell from '../../src/renderer/central/AutomationsShell.vue'
import CodexHandoff from '../../src/renderer/central/CodexHandoff.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { codexBrief } from '../../src/renderer/utils/codex-brief'
import fixture from './map-view.json'

// Creation stays with Codex: the brief text with and without a pinned node, on the desktop and in the browser.
const view = parseMapView(fixture) as MapView
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals(); applyLanguage('en') })
const order = 'Zeig mir zuerst Bauform (welche Pods welche gemeinsamen Daten lesen und schreiben), Karte, benötigte Zugriffe und die Beispiele, die du als Prüfung verwendest. Lege erst danach an, aktiviere nur als Vorschau, und fordere Rechte ausschließlich über Permissions und den IdP an.'

describe('Codex handoff', () => {
  it('builds the brief from the tags and the pinned node', () => {
    applyLanguage('de')
    expect(codexBrief(view, null, [])).toBe(`Lege eine neue Automatisierung an. ${order}`)
    expect(codexBrief(view, null, ['iurio'])).toBe(`Lege eine neue Automatisierung mit den Tags #iurio an. ${order}`)
    expect(codexBrief(view, 'app:o365-cli:phofmann@delta-mind.at', ['delta-mind', 'mail'])).toBe(`Lege eine neue Automatisierung mit den Tags #delta-mind, #mail an. Ausgangspunkt: phofmann@delta-mind.at (lesen). ${order}`)
    expect(codexBrief(view, 'svc:https://api.telegram.org', [])).toContain('Ausgangspunkt: api.telegram.org (lesen).')
    expect(codexBrief(view, view.pods.find(pod => pod.name === 'zaz Service-Agent')!.id, [])).toBe(`Lege eine neue Automatisierung an. Wie zaz Service-Agent, aber mit anderer Quelle. ${order}`)
    applyLanguage('en')
    expect(codexBrief(view, null, ['linde'])).toMatch(/^Create a new automation with the tags #linde\. Show me first the shape/)
  })

  it('copies the brief to the clipboard and shows the Codex connection where the host knows it', async () => {
    applyLanguage('de')
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    wrapper = mount(CodexHandoff, { attachTo: document.body, props: { view, pinned: null, tags: ['iurio'], connected: true } })
    expect(wrapper.find('[data-testid="codex-brief"]').text()).toBe(`Lege eine neue Automatisierung mit den Tags #iurio an. ${order}`)
    expect(wrapper.find('.pill').text()).toBe('Codex verbunden')
    await wrapper.findAll('button').find(item => item.text() === 'Auftrag kopieren')!.trigger('click'); await flushPromises()
    expect(writeText).toHaveBeenCalledWith(`Lege eine neue Automatisierung mit den Tags #iurio an. ${order}`)
    expect(wrapper.findAll('button').map(item => item.text())).toContain('Kopiert, in Codex einfügen')
    await wrapper.findAll('button').find(item => item.text() === 'Einstellungen')!.trigger('click')
    expect(wrapper.emitted('settings')).toHaveLength(1)
    await wrapper.findAll('button').find(item => item.text() === 'Schließen')!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    wrapper = mount(CodexHandoff, { props: { view, pinned: null, tags: [], connected: null } })
    expect(wrapper.find('.pill').exists()).toBe(false)
  })

  it('opens from the toolbar with the pinned node and its tags and closes again', async () => {
    applyLanguage('de')
    const tagged = structuredClone(view)
    tagged.pods.find(pod => pod.name === 'Mail-Klassifizierung')!.tags = { own: ['delta-mind', 'mail'], revision: 1 }
    wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view: tagged, live: false, now: view.at, desktop: true, codex: 'disconnected' } })
    await flushPromises()
    const shell = wrapper.vm as unknown as { pin: (id: string | null) => void }
    shell.pin(view.pods.find(pod => pod.name === 'Mail-Klassifizierung')!.id); await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === 'Neue Automatisierung mit Codex')!.trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="codex-brief"]').text()).toBe(`Lege eine neue Automatisierung mit den Tags #delta-mind, #mail an. Wie Mail-Klassifizierung, aber mit anderer Quelle. ${order}`)
    expect(wrapper.find('.codex-handoff .pill').text()).toBe('Codex nicht verbunden')
    await wrapper.findAll('button').find(item => item.text() === 'Schließen')!.trigger('click')
    expect(wrapper.find('.codex-handoff').exists()).toBe(false)
  })
})
