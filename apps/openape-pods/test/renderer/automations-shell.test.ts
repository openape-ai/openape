import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import AutomationsShell from '../../src/renderer/central/AutomationsShell.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { clock, stamp } from '../../src/renderer/utils/cadence'
import fixture from './map-view.json'
import type { SecretsView } from '../../src/contracts/secrets'

// Visible text and emitted commands of the Automatisierungen surface; geometry lives in test/layout/automations.test.ts.
const view = parseMapView(fixture) as MapView
const NOW = view.at + 11 * 60000
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en') })
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
      ['5', 'aktiv', 'Pods, Ketten und Netze mit laufendem Zeitplan'],
      ['6', 'pausiert', 'davon 2 Netze, 1 Entwürfe, 1 archiviert'],
      ['1', 'gestört', 'IURIO PR monitor · mit Lücken abgeschlossen'],
      // A run waiting for its grant at the IdP is a decision as well.
      ['18', 'Entscheidungen warten auf dich', 'Review uncertain mail · Delta Mind, 1 Laufzeit-Anfragen'],
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

  it('offers map and list, the groups of the organization, five layer chips and the Codex button', async () => {
    applyLanguage('de')
    await mountShell()
    expect(wrapper!.find('[aria-label="Ansicht"]').findAll('button').map(item => item.text())).toEqual(['Karte', 'Liste'])
    expect(wrapper!.find('[aria-label="Gruppe"]').findAll('button').map(item => item.text())).toEqual(['Alle', 'Delta Mind', 'iurio', 'Linde', 'Ohne Gruppe'])
    expect(wrapper!.find('[aria-label="Ebenen"]').findAll('button').map(item => item.text())).toEqual(['Kanäle', 'Lesen', 'Schreiben', 'Freigaben', 'Pausierte'])
    expect(wrapper!.find('[data-testid="automations-map"] canvas').attributes('aria-label')).toBe('Animierte Netzkarte aller Pods mit Datenquellen, Speichern und Entscheidungsstellen')
    await button('Pausierte').trigger('click')
    expect(button('Pausierte').attributes('aria-pressed')).toBe('false')
    await button('⚙ Einstellungen').trigger('click'); await flushPromises()
    expect(wrapper!.find('.app-settings-menu').exists()).toBe(true)
    await button('⚙ Einstellungen').trigger('click'); await flushPromises()
    expect(wrapper!.find('.app-settings-menu').exists()).toBe(false)
    await button('Entscheidungen 17').trigger('click')
    expect(wrapper!.emitted('update:tab')).toEqual([['decisions']])
    await button('Neue Automatisierung mit Codex').trigger('click')
    expect(wrapper!.emitted('codex')).toEqual([[null, null]])
    await button('iurio').trigger('click')
    await button('Neue Automatisierung mit Codex').trigger('click')
    expect(wrapper!.emitted('codex')!.at(-1)).toEqual([null, 'iurio'])
  })

  it('lists the same Pods as a table with group, kind, cadence, reads, writes, channels and last run', async () => {
    applyLanguage('de')
    await mountShell()
    await button('Liste').trigger('click')
    const rows = wrapper!.findAll('tbody tr')
    const activeCollections = new Set(view.automations.filter(automation => automation.state === 'active').map(automation => automation.id))
    const expected = view.pods.filter(pod => pod.lifecycle !== 'archived' && (!pod.automation || activeCollections.has(pod.automation))).length + view.automations.filter(automation => automation.state === 'paused').length
    expect(rows).toHaveLength(expected)
    expect(expected).toBe(23)
    expect(wrapper!.findAll('thead th').map(item => item.text())).toEqual(['Pod', 'Gruppe', 'Art', 'Läuft', 'Liest', 'Schreibt', 'Kanäle', 'Zuletzt'])
    const cells = (name: string) => rows.find(row => row.text().includes(name))!.findAll('td').map(cell => cell.findAll('div').length > 1 ? cell.findAll('div').map(item => item.text()).join(' ') : cell.text().replace(/\s+/g, ' '))
    expect(cells('Triage')).toEqual(['Triage', 'Delta Mind', 'KI', 'bei Items', 'TypeSafe / Jev, delta', 'delta', '← mail.filtered → mail.triaged', 'vor 1 h · abgeschlossen'])
    expect(cells('zaz Service-Agent')).toEqual(['zaz Service-Agent', 'ohne Gruppe', 'Regeln', 'alle 1 min', 'zaz.delta-mind.at', 'zaz.delta-mind.at', '–', 'vor 11 min · abgeschlossen'])
    expect(cells('DOCPIT')).toEqual(['IURIO · DOCPIT mail management', 'iurio', 'eingeklappt', '–', 'patrick@docpit.eu', 'patrick@docpit.eu', '–', 'pausiert'])
    await button('Linde').trigger('click')
    expect(wrapper!.findAll('tbody tr').map(row => row.find('td').text())).toEqual(['Linde · Server report', 'Linde · Portal development and systems'])
    await wrapper!.findAll('tbody tr')[0]!.trigger('click')
    expect(wrapper!.find('.automation-detail .dhead b').text()).toBe('Linde · Server report')
  })

  it('describes a pinned node in the info panel and opens its details', async () => {
    applyLanguage('de')
    await mountShell()
    expect(wrapper!.find('.automation-info').text()).toBe('Knoten anklicken. Doppelklick oder „Details öffnen“ zeigt die Detailseite.')
    const shell = wrapper!.vm as unknown as { pin: (id: string | null) => void }
    shell.pin(pod('Triage').id); await flushPromises()
    const info = wrapper!.find('.automation-info').text().replace(/\s+/g, ' ')
    expect(info).toContain('Triage')
    expect(info).toContain('gepinnt')
    expect(info).toContain('bei Items · 10 Läufe gesamt')
    expect(info).toContain(`zuletzt ${stamp(pod('Triage').lastRun!.at, 'de')} · abgeschlossen: Triage completed`)
    expect(info).toContain('Kanäle: ← mail.filtered (7), → mail.triaged (8)')
    expect(info).toContain('liest: TypeSafe / Jev (10), delta (10)')
    expect(info).toContain('schreibt: delta (10)')
    await button('Details öffnen').trigger('click')
    expect(wrapper!.find('.automation-detail .dhead b').text()).toBe('Triage')
    await wrapper!.find('.automation-detail .x').trigger('click')
    expect(wrapper!.find('.automation-detail').exists()).toBe(false)
    shell.pin('app:o365-cli:phofmann@delta-mind.at'); await flushPromises()
    expect(wrapper!.find('.automation-info').text()).toContain('phofmann@delta-mind.at')
    expect(wrapper!.find('.automation-info').text()).toContain('o365-cli · installiert')
    expect(wrapper!.findAll('.automation-info button')).toHaveLength(0)
    shell.pin(view.automations[0]!.id); await flushPromises()
    expect(wrapper!.find('.automation-info').text()).toContain('11 Mitglieder · aktiv')
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

  it('opens the secret form from the detail and hands typed values, files and requests to the host', async () => {
    const bot = pod('Morgenbriefing · Calendar-Bot')
    const secrets: SecretsView = { origin: 'https://secrets.openape.ai', consumer: { id: '01CONSUMER0', registeredAt: NOW }, requests: [{ id: '01REQ0', podId: bot.id, alias: 'calendar_bot_token', purpose: 'Calendar access', status: 'requested', expiresAt: NOW + 86400000, createdAt: NOW, updatedAt: NOW, error: null }] }
    await mountShell({ desktop: true, secrets })
    ;(wrapper!.vm as unknown as { open: (id: string) => void }).open(bot.id); await flushPromises()
    expect(wrapper!.find('[data-testid="secret-form"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="secret-request"]').text()).toContain('calendar_bot_token')
    expect(wrapper!.find('[data-testid="secret-request"]').text()).toContain('requested')
    await button('+ Secret').trigger('click')
    expect(wrapper!.find('[data-testid="secret-form"]').exists()).toBe(true)
    await wrapper!.find('[data-testid="secret-form"] input').setValue('reports_publisher_key')
    await wrapper!.find('[data-testid="secret-form"] input[type="password"]').setValue('value-1')
    await button('Save').trigger('click')
    expect(wrapper!.emitted('secretSave')).toEqual([[bot.id, 'reports_publisher_key', 'value-1']])
    expect(wrapper!.find('[data-testid="secret-form"]').exists()).toBe(false)
    await button('Replace').trigger('click')
    expect((wrapper!.find('[data-testid="secret-form"] input').element as HTMLInputElement).value).toBe('calendar_bot_token')
    await wrapper!.findAll('[data-testid="secret-form"] .seg button')[2]!.trigger('click')
    await wrapper!.findAll('[data-testid="secret-form"] input')[1]!.setValue('Calendar of both accounts')
    await button('Request').trigger('click')
    expect(wrapper!.emitted('secrets')).toEqual([[{ type: 'request', podId: bot.id, alias: 'calendar_bot_token', purpose: 'Calendar of both accounts' }]])
    await button('+ Secret').trigger('click')
    await wrapper!.findAll('[data-testid="secret-form"] .seg button')[1]!.trigger('click')
    await wrapper!.find('[data-testid="secret-form"] input').setValue('pem_key')
    await button('Choose file…').trigger('click')
    expect(wrapper!.emitted('secrets')!.at(-1)).toEqual([{ type: 'importFile', podId: bot.id, alias: 'pem_key' }])
    await button('⚙ Settings').trigger('click'); await flushPromises()
    expect(wrapper!.find('[data-consumer]').text()).toContain('01CONSUMER0')
    await button('Revoke').trigger('click')
    expect(wrapper!.emitted('secrets')!.at(-1)).toEqual([{ type: 'revokeConsumer' }])
  })
})
