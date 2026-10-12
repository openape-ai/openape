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
async function mountDetail(id: string, desktop = true) {
  applyLanguage('de')
  wrapper = mount(AutomationDetail, { attachTo: document.body, props: { view, id, now: NOW, desktop } })
  await flushPromises()
  return wrapper
}
const button = (text: string) => wrapper!.findAll('button').find(item => item.text().trim() === text)!
const section = (eyebrow: string) => wrapper!.findAll('.sec').find(item => item.find('.eyebrow').exists() && item.find('.eyebrow').text() === eyebrow)!

describe('AutomationDetail', () => {
  it('shows a Pod with state, access by kind, secrets as aliases, shared data, declared work, developer facts and the latest run', async () => {
    const classification = pod('Mail-Klassifizierung')
    await mountDetail(classification.id)
    expect(wrapper!.find('.dhead b').text()).toBe('Mail-Klassifizierung')
    expect(wrapper!.findAll('.row .pill').map(item => item.text())).toEqual(['aktiv', 'Pod', 'Delta Mind'])
    expect(section('Services, per HTTPS').text()).toContain('TypeSafe / Jev')
    expect(section('Services, per HTTPS').text()).toContain('jev-1.13.0 · 20')
    expect(section('Services, per HTTPS').text()).toContain('zugewiesen')
    expect(section('Verzeichnisse und Dateien').text()).toContain('delta')
    expect(section('Verzeichnisse und Dateien').text()).toContain('readWrite')
    expect(section('Geheimnisse').text()).toContain('keine')
    expect(button('+ Geheimnis').exists()).toBe(true)
    const shared = section('Gemeinsame Daten').text().replace(/\s+/g, ' ')
    expect(shared).toContain('schreibt delta-mind/mail/classifications (15)')
    expect(shared).toContain('liest delta-mind/mail/messages')
    expect(shared).toContain('liest delta-mind/mail/owner-answers')
    expect(section('Für Entwickler').text()).toContain(`pods/${classification.id}/pod-script.mjs`)
    expect(section('Für Entwickler').text()).toContain(`Aktives Script: ${classification.script!.slice(0, 12)}`)
    expect(section('Letzter Lauf').text()).toContain(stamp(classification.lastRun!.at, 'de'))
    expect(section('Letzter Lauf').text()).toContain('abgeschlossen')
    expect(section('Letzter Lauf').text()).toContain('10 Läufe gesamt')
    expect(wrapper!.find('[data-work]').exists()).toBe(false)
    expect(JSON.stringify(wrapper!.html())).not.toMatch(/credentialId|"value"/)
  })

  it('shows declared work waiting and held for the owner', async () => {
    const invoices = pod('Rechnungsprüfung')
    Object.assign(invoices, { work: { pending: 3, held: 1 } })
    try {
      await mountDetail(invoices.id)
      expect(wrapper!.find('[data-work]').text()).toBe('Deklarierte Arbeit3 wartend · 1 für dich angehalten')
    }
    finally { Object.assign(invoices, { work: { pending: 0, held: 0 } }) }
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
