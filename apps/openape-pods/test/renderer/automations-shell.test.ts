import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import AutomationsShell from '../../src/renderer/central/AutomationsShell.vue'
import TagEditor from '../../src/renderer/central/TagEditor.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { clock, stamp } from '../../src/renderer/utils/cadence'
import fixture from './map-view.json'

// Visible text and emitted commands of the Automatisierungen surface; geometry lives in test/layout/automations.test.ts.
const view = parseMapView(fixture) as MapView
const NOW = view.at + 11 * 60000
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en'); localStorage.clear() })
async function mountShell(props: Record<string, unknown> = {}) {
  wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: false, now: NOW, decisions: 17, ...props } })
  await flushPromises()
  return wrapper
}
const button = (text: string) => wrapper!.findAll('button').find(item => item.text().trim() === text)!
const pod = (name: string) => view.pods.find(item => item.name === name)!

describe('Automatisierungen', () => {
  it('shows the five system KPIs with subtitles from the data, in German and English', async () => {
    applyLanguage('de')
    await mountShell()
    const kpis = wrapper!.findAll('.kpi').map(item => [item.find('b').text(), item.find('span').text(), item.find('small').text()])
    expect(kpis).toEqual([
      ['5', 'aktiv', 'Pods mit laufendem Zeitplan'],
      ['25', 'pausiert', 'davon 1 Entwürfe, 1 archiviert'],
      ['1', 'gestört', 'IURIO PR monitor · mit Lücken abgeschlossen'],
      // A run waiting for its grant at the IdP is an approval as well.
      ['22', 'Entscheidungen warten auf dich', '17 Rückfragen, 5 Freigaben'],
      ['1', 'unklare Zustellungen', '1 Zustellungen abzugleichen'],
    ])
    expect(wrapper!.find('.kpi.alert').text()).toContain('gestört')
    expect(wrapper!.find('[role="tablist"]').text()).toContain('Automatisierungen')
    expect(wrapper!.find('[role="tablist"]').text()).toContain('Entscheidungen 17')
    expect(wrapper!.find('.automations-stamp').text()).toBe(`Stand ${clock(view.at, 'de')}`)
    expect(wrapper!.find('.kinds').text()).toContain('Service, per HTTPS')
    wrapper!.unmount(); applyLanguage('en')
    await mountShell({ live: true })
    expect(wrapper!.findAll('.kpi span').map(item => item.text())).toEqual(['active', 'paused', 'degraded', 'decisions waiting for you', 'unknown deliveries'])
    expect(wrapper!.find('.automations-stamp').text()).toBe(`Live · ${clock(NOW, 'en')}`)
  })

  it('offers map and list, five layer chips behind one menu and the Codex button', async () => {
    applyLanguage('de')
    await mountShell()
    expect(wrapper!.find('[aria-label="Ansicht"]').findAll('button').map(item => item.text())).toEqual(['Karte', 'Liste'])
    // Rows are the default; the map is one click away.
    expect(wrapper!.find('.automations-list').exists()).toBe(true)
    await button('Karte').trigger('click')
    expect(wrapper!.find('[aria-label="Gruppe"]').exists()).toBe(false)
    // Without any tag in the workspace there is no tag bar and everything stays visible.
    expect(wrapper!.find('[aria-label="Tags"]').exists()).toBe(false)
    expect(wrapper!.find('.layers-menu summary').text()).toBe('Ebenen 5/5')
    expect(wrapper!.find('[aria-label="Ebenen"]').findAll('button').map(item => item.text())).toEqual(['Gemeinsame Daten', 'Lesen', 'Schreiben', 'Freigaben', 'Pausierte'])
    expect(wrapper!.find('[data-testid="automations-map"] canvas').attributes('aria-label')).toBe('Animierte Netzkarte aller Pods mit Datenquellen, Speichern und Entscheidungsstellen')
    await button('Pausierte').trigger('click')
    expect(button('Pausierte').attributes('aria-pressed')).toBe('false')
    expect(wrapper!.find('.layers-menu summary').text()).toBe('Ebenen 4/5')
    await button('⚙ Einstellungen').trigger('click'); await flushPromises()
    expect(wrapper!.find('.app-settings-menu').exists()).toBe(true)
    await button('⚙ Einstellungen').trigger('click'); await flushPromises()
    expect(wrapper!.find('.app-settings-menu').exists()).toBe(false)
    await button('Entscheidungen 17').trigger('click')
    expect(wrapper!.emitted('update:tab')).toEqual([['decisions']])
    await button('Neue Automatisierung mit Codex').trigger('click')
    expect(wrapper!.emitted('codex')).toEqual([[null, null]])
    // The new automation goes next to the pinned Pod, in its group.
    const monitor = pod('IURIO PR monitor').id
    ;(wrapper!.vm as unknown as { pin: (id: string) => void }).pin(monitor)
    await button('Neue Automatisierung mit Codex').trigger('click')
    expect(wrapper!.emitted('codex')!.at(-1)).toEqual([monitor, 'iurio'])
  })

  it('lists every Pod with purpose, state, last result, next run and what it waits for', async () => {
    applyLanguage('de')
    await mountShell()
    const rows = wrapper!.findAll('tbody tr')
    expect(rows).toHaveLength(view.pods.filter(pod => pod.lifecycle !== 'archived').length)
    expect(wrapper!.findAll('thead th').map(item => item.text())).toEqual(['Pod', 'Zustand', 'Letztes Ergebnis', 'Nächster Lauf', 'Wartet auf'])
    const cells = (name: string) => rows.find(row => row.find('b').text() === name)!.findAll('td').slice(1).map(cell => cell.text().replace(/\s+/g, ' ').trim())
    // The fixture has no descriptions; a missing purpose is named, not left blank.
    expect(rows.every(row => row.find('.automations-list-purpose').text() === 'Zweck fehlt')).toBe(true)
    expect(cells('Rechnungsprüfung')).toEqual(['OK', 'noch kein Lauf', 'bei neuen gemeinsamen Daten', '–'])
    expect(cells('zaz Service-Agent')).toEqual(['OK', 'vor 11 min · zaz queue empty; no model call', 'alle 1 min', '–'])
    expect(cells('IURIO · Mail-Synchronisierung')).toEqual(['pausiert', 'noch kein Lauf', 'pausiert', '–'])
    expect(cells('IURIO PR monitor')).toEqual(['Fehler', 'läuft gerade', 'alle 15 min', 'deine Freigabe am IdP'])
    // One click opens the Pod page; there is no detail dialog in between.
    await rows.find(row => row.text().includes('Linde · Server report'))!.trigger('click')
    expect(wrapper!.emitted('openPod')).toEqual([[pod('Linde · Server report').id]])
  })

  it('describes a pinned node in the info panel and opens its details', async () => {
    applyLanguage('de')
    await mountShell()
    await button('Karte').trigger('click')
    expect(wrapper!.find('.automation-info').text()).toBe('Knoten anklicken. Doppelklick oder „Details öffnen“ zeigt die Detailseite.')
    const shell = wrapper!.vm as unknown as { pin: (id: string | null) => void }
    shell.pin(pod('Mail-Klassifizierung').id); await flushPromises()
    const info = wrapper!.find('.automation-info').text().replace(/\s+/g, ' ')
    expect(info).toContain('Mail-Klassifizierung')
    expect(info).toContain('gepinnt')
    expect(info).toContain('bei gemeinsamen Daten · 10 Läufe gesamt')
    expect(info).toContain(`zuletzt ${stamp(pod('Mail-Klassifizierung').lastRun!.at, 'de')} · abgeschlossen: Mail-Klassifizierung completed`)
    expect(info).toContain('Gemeinsame Daten: → delta-mind/mail/classifications (15), ← delta-mind/mail/messages (20)')
    expect(info).toContain('liest: TypeSafe / Jev (10), delta (10)')
    expect(info).toContain('schreibt: delta (10)')
    await button('Details öffnen').trigger('click')
    expect(wrapper!.emitted('openPod')).toEqual([[pod('Mail-Klassifizierung').id]])
    shell.pin('app:o365-cli:phofmann@delta-mind.at'); await flushPromises()
    expect(wrapper!.find('.automation-info').text()).toContain('phofmann@delta-mind.at')
    expect(wrapper!.find('.automation-info').text()).toContain('o365-cli · installiert')
    expect(wrapper!.findAll('.automation-info button')).toHaveLength(0)
  })

  it('shows the loading state without a map and the decisions inbox on the second tab', async () => {
    await mountShell({ view: null, decisions: 0 })
    expect(wrapper!.find('[role="status"]').text()).toBe('Loading workspace…')
    expect(wrapper!.find('[role="tablist"]').text()).not.toContain('0')
    wrapper!.unmount()
    wrapper = mount(AutomationsShell, { props: { view, live: true, now: NOW, tab: 'decisions' } })
    await flushPromises()
    expect(wrapper.find('.decisions-inbox').exists()).toBe(true)
    expect(wrapper.findAll('.kpi')).toHaveLength(5)
    expect(wrapper.find('[role="tablist"]').text()).toContain('Decisions 2')
  })
})

describe('Tags (issue 1459)', () => {
  // The Delta Mind mail Pods carry two tags, kept as their own when their network was converted; one monitor has its own.
  function tagged(): MapView {
    const copy = structuredClone(view)
    for (const member of copy.pods.filter(item => item.group === 'Delta Mind')) member.tags = { own: ['delta-mind', 'mail'], revision: 1 }
    copy.pods.find(item => item.name === 'IURIO PR monitor')!.tags = { own: ['iurio'], revision: 3 }
    return parseMapView(copy)
  }

  const rows = () => wrapper!.findAll('.automations-list tbody tr').map(row => row.find('b').text())

  it('starts with the Pods without a tag, shows the Pods per tag and adds every activated tag to the list', async () => {
    const tagsView = tagged()
    const members = tagsView.pods.filter(item => item.tags?.own.includes('mail')).length
    const visible = tagsView.pods.filter(item => item.lifecycle !== 'archived').length
    const untaggedCount = visible - members - 1
    await mountShell({ view: tagsView })
    await button('List').trigger('click')
    expect(wrapper!.find('[aria-label="Tags"]').findAll('button[aria-pressed]').map(item => item.text())).toEqual([`#delta-mind ${members}`, '#iurio 1', `#mail ${members}`, `Without tag ${untaggedCount}`])
    expect(button(`Without tag ${untaggedCount}`).attributes('aria-pressed')).toBe('true')
    expect(rows()).toHaveLength(untaggedCount)
    await button(`Without tag ${untaggedCount}`).trigger('click')
    expect(wrapper!.find('.automations-empty').text()).toBe(`Activate tags to see their Pods (${visible} Pods).`)
    await button('#iurio 1').trigger('click')
    expect(rows()).toEqual(['IURIO PR monitor'])
    expect(wrapper!.find('.automations-list .tag-chips').text()).toBe('iurio')
    await button(`#delta-mind ${members}`).trigger('click')
    expect(rows()).toContain('IURIO PR monitor')
    expect(rows()).toHaveLength(members + 1)
    await button('All').trigger('click')
    expect(rows()).toHaveLength(29)
    await button('None').trigger('click')
    expect(wrapper!.find('.automations-empty').exists()).toBe(true)
  })

  it('remembers the activated tags, the deselected Pods without a tag and the view on this device', async () => {
    const tagsView = tagged()
    const untaggedCount = tagsView.pods.filter(item => item.lifecycle !== 'archived' && !item.tags).length
    await mountShell({ view: tagsView })
    await button('List').trigger('click')
    await button(`Without tag ${untaggedCount}`).trigger('click')
    await button('#iurio 1').trigger('click')
    wrapper!.unmount()
    await mountShell({ view: tagged() })
    expect(wrapper!.find('.automations-list').exists()).toBe(true)
    expect(rows()).toEqual(['IURIO PR monitor'])
  })

  it('saves edited own tags as one workspace command with the current revision', async () => {
    const id = pod('IURIO PR monitor').id
    wrapper = mount(TagEditor, { attachTo: document.body, props: { id, tags: { own: ['iurio'], revision: 3 }, suggestions: ['iurio'] } })
    await wrapper.find('input').setValue('  Entwicklung ')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('input').setValue('a/b')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await wrapper.findAll('button').find(item => item.text() === 'Save tags')!.trigger('click')
    expect(wrapper.emitted('command')!.at(-1)).toEqual([{ channel: 'workspace', body: { type: 'tag', id, revision: 3, tags: ['iurio', 'entwicklung'] } }])
  })
})
