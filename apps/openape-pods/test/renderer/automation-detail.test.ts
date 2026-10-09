import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import AutomationDetail from '../../src/renderer/central/AutomationDetail.vue'
import AutomationsShell from '../../src/renderer/central/AutomationsShell.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { stamp } from '../../src/renderer/utils/cadence'
import fixture from './map-view.json'

// Visible sections and the exact owner commands of the detail page; geometry lives in test/layout/automations.test.ts.
const view = parseMapView(fixture) as MapView
const NOW = view.at + 11 * 60000
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en') })
const pod = (name: string) => view.pods.find(item => item.name === name)!
const automation = (name: string) => view.automations.find(item => item.name === name)!
async function mountDetail(id: string, desktop = true) {
  applyLanguage('de')
  wrapper = mount(AutomationDetail, { attachTo: document.body, props: { view, id, now: NOW, desktop } })
  await flushPromises()
  return wrapper
}
const button = (text: string) => wrapper!.findAll('button').find(item => item.text().trim() === text)!
const section = (eyebrow: string) => wrapper!.findAll('.sec').find(item => item.find('.eyebrow').exists() && item.find('.eyebrow').text() === eyebrow)!

describe('AutomationDetail', () => {
  it('shows the latest assistant script update of a network member', async () => {
    const triage = pod('Triage')
    const previous = 'a'.repeat(64); const script = 'b'.repeat(64)
    Object.assign(triage, { scriptUpdate: { at: view.at, previous, script } })
    try {
      await mountDetail(triage.id)
      expect(wrapper!.find('[data-script-update]').text()).toBe(`SkriptänderungenVom Assistenten aktualisiert ${stamp(view.at, 'de')}: aaaaaaaa → bbbbbbbb`)
    }
    finally { delete (triage as { scriptUpdate?: unknown }).scriptUpdate }
  })

  it('shows a Pod with state, schedule, membership, access by kind, secrets as aliases, channels, developer facts and the latest run', async () => {
    const triage = pod('Triage')
    await mountDetail(triage.id)
    expect(wrapper!.find('.dhead b').text()).toBe('Triage')
    expect(wrapper!.findAll('.row .pill').map(item => item.text())).toEqual(['aktiv', 'Pod', 'Delta Mind'])
    expect(section('Teil von').text()).toContain('Delta Mind · Mail-Netzwerk')
    expect(section('Services, per HTTPS').text()).toContain('TypeSafe / Jev')
    expect(section('Services, per HTTPS').text()).toContain('jev-1.13.0 · 20')
    expect(section('Services, per HTTPS').text()).toContain('zugewiesen')
    expect(section('Verzeichnisse und Dateien').text()).toContain('delta')
    expect(section('Verzeichnisse und Dateien').text()).toContain('readWrite')
    expect(section('Geheimnisse').text()).toContain('keine')
    expect(button('+ Geheimnis').exists()).toBe(true)
    expect(section('Kanäle').text().replace(/\s+/g, ' ')).toContain('nimmt mail.filtered (7)')
    expect(section('Kanäle').text().replace(/\s+/g, ' ')).toContain('gibt mail.triaged (8)')
    expect(section('Für Entwickler').text()).toContain(`pods/${triage.id}/pod-script.mjs`)
    expect(section('Für Entwickler').text()).toContain(`Aktives Script: ${triage.script!.slice(0, 12)}`)
    expect(section('Letzter Lauf').text()).toContain(stamp(triage.lastRun!.at, 'de'))
    expect(section('Letzter Lauf').text()).toContain('abgeschlossen')
    expect(section('Letzter Lauf').text()).toContain('10 Läufe gesamt')
    expect(JSON.stringify(wrapper!.html())).not.toMatch(/credentialId|"value"/)
    await section('Teil von').find('button').trigger('click')
    expect(wrapper!.emitted('open')).toEqual([[automation('Delta Mind · Mail-Netzwerk').id]])
  })

  it('emits the exact lifecycle, run, secret and folder commands of a Pod', async () => {
    const monitor = pod('IURIO PR monitor')
    await mountDetail(monitor.id)
    expect(wrapper!.findAll('.row .pill').map(item => item.text())).toEqual(['läuft mit Lücken', 'Pod', 'iurio'])
    expect(section('Geheimnisse').text()).toContain('telegram_bot_token')
    expect(section('Geheimnisse').text()).toContain('gesetzt · nur im Script lesbar')
    expect(section('Applikationen, installiert').text()).toContain('List pull requests for repository iurioServer')
    await button('Pausieren').trigger('click')
    expect(wrapper!.emitted('command')).toEqual([[{ channel: 'scheduling', body: { type: 'lifecycle', podId: monitor.id, revision: monitor.revision, lifecycle: 'paused' } }]])
    await button('Jetzt ausführen').trigger('click')
    expect(wrapper!.emitted('command')!.at(-1)).toEqual([{ channel: 'runs', body: { type: 'start', podId: monitor.id, expectedScript: monitor.script } }])
    await button('Ersetzen').trigger('click')
    expect(wrapper!.emitted('secret')).toEqual([[monitor.id, 'telegram_bot_token']])
    await button('+ Geheimnis').trigger('click')
    expect(wrapper!.emitted('secret')!.at(-1)).toEqual([monitor.id, null])
    await button('Im Editor öffnen').trigger('click')
    expect(wrapper!.emitted('folder')).toEqual([[monitor.id]])
    wrapper!.unmount()
    const paused = pod('Mail-Kurzbericht')
    await mountDetail(paused.id, false)
    expect(wrapper!.findAll('.row .pill').map(item => item.text())).toEqual(['pausiert', 'Pod', 'ohne Gruppe'])
    expect(wrapper!.findAll('button').map(item => item.text().trim())).not.toContain('Jetzt ausführen')
    await button('Fortsetzen').trigger('click')
    expect(wrapper!.emitted('command')).toEqual([[{ channel: 'scheduling', body: { type: 'lifecycle', podId: paused.id, revision: paused.revision, lifecycle: 'active' } }]])
    expect(button('Im Editor öffnen').attributes('disabled')).toBeDefined()
    expect(button('Im Editor öffnen').attributes('title')).toBe('Nur am Desktop')
  })

  it('shows a network with members, decision points and numbers and pauses it only on the desktop', async () => {
    const network = automation('Delta Mind · Mail-Netzwerk')
    await mountDetail(network.id)
    expect(wrapper!.findAll('.row .pill').map(item => item.text())).toEqual(['aktiv', 'Netzwerk', 'Delta Mind'])
    expect(section('Zeitplan').text()).toBe('Zeitplanalle 15 min')
    expect(section('Mitglieder').findAll('button')).toHaveLength(11)
    expect(section('Entscheidungsstellen').text()).toContain('Review uncertain mail: du entscheidest (17 offen)')
    expect(section('Entscheidungsstellen').text()).toContain('Approve newsletter preview (no move): Freigabe am IdP (0 Batches)')
    expect(section('Zahlen').text()).toContain('Lieferungen: 80')
    expect(section('Zahlen').text()).toContain('mail.unsure 14')
    await section('Mitglieder').findAll('button')[3]!.trigger('click')
    expect(wrapper!.emitted('open')).toEqual([[network.members[3]]])
    await button('Pausieren').trigger('click')
    expect(wrapper!.emitted('network')).toEqual([[{ type: 'pause', id: network.id, revision: network.revision }]])
    wrapper!.unmount()
    await mountDetail(network.id, false)
    expect(button('Pausieren').attributes('disabled')).toBeDefined()
    expect(button('Pausieren').attributes('title')).toBe('Nur am Desktop')
  })

  it('controls a chain and a bounded graph through workflow commands', async () => {
    const chain = automation('Morgenbriefing')
    await mountDetail(chain.id)
    expect(wrapper!.findAll('.row .pill').map(item => item.text())).toEqual(['aktiv', 'Kette', 'ohne Gruppe'])
    expect(section('Zeitplan').text()).toBe('Zeitplantäglich 07:00')
    await button('Jetzt ausführen').trigger('click')
    expect(wrapper!.emitted('workflow')).toEqual([[{ type: 'start', id: chain.id, revision: chain.revision }]])
    await button('Pausieren').trigger('click')
    expect(wrapper!.emitted('workflow')!.at(-1)).toEqual([{ type: 'pause', id: chain.id, revision: chain.revision, paused: true }])
    wrapper!.unmount()
    const graph = automation('IURIO · DOCPIT mail management')
    await mountDetail(graph.id)
    expect(wrapper!.findAll('.row .pill').map(item => item.text())).toEqual(['pausiert', 'Netzwerk', 'iurio'])
    await button('Fortsetzen').trigger('click')
    expect(wrapper!.emitted('workflow')).toEqual([[{ type: 'pause', id: graph.id, revision: graph.revision, paused: false }]])
  })

  it('opens from the shell by list row or info panel and closes again', async () => {
    applyLanguage('de')
    wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: false, now: NOW, desktop: true } })
    await flushPromises()
    expect(wrapper.find('.automation-detail').exists()).toBe(false)
    await wrapper.findAll('button').find(item => item.text() === 'Liste')!.trigger('click')
    await wrapper.findAll('tbody tr').find(row => row.text().includes('zaz Service-Agent'))!.trigger('click')
    expect(wrapper.find('.automation-detail .dhead b').text()).toBe('zaz Service-Agent')
    await wrapper.find('.automation-detail').findAll('button').find(item => item.text() === 'Pausieren')!.trigger('click')
    expect(wrapper.emitted('command')).toEqual([[{ channel: 'scheduling', body: { type: 'lifecycle', podId: pod('zaz Service-Agent').id, revision: pod('zaz Service-Agent').revision, lifecycle: 'paused' } }]])
    await wrapper.find('.automation-detail .x').trigger('click')
    expect(wrapper.find('.automation-detail').exists()).toBe(false)
  })
})
