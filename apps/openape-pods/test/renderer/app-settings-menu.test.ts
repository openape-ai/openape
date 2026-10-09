import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import AppSettingsMenu from '../../src/renderer/central/AppSettingsMenu.vue'
import AutomationsShell from '../../src/renderer/central/AutomationsShell.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { installWorkspace } from '../layout/workspace-fixture'
import fixture from './map-view.json'

// The gear menu: account rows, the execution switch, the MCP session, language, backups and the grants link.
const view = parseMapView(fixture) as MapView
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals(); applyLanguage('en') })
const account = (name: string) => wrapper!.find(`[data-account="${name}"]`)

describe('Settings menu', () => {
  it('shows the accounts, the execution switch and the MCP session on the desktop and sends them as commands', async () => {
    const runtimeApproval = vi.fn(async (command: { type: string, enabled?: boolean }) => ({ enabled: command.type === 'set' ? !!command.enabled : true, standing: false, owner: 'patrick@example.invalid', scope: null }))
    let expiresAt: number | null = new Date(2026, 9, 9, 16, 45).getTime()
    const mcpSession = vi.fn(async (command: { type: string }) => { if (command.type === 'end') expiresAt = null; return { expiresAt, pending: false } })
    const onboarding = vi.fn(async () => ({ connections: [{ id: 'owner', provider: 'openape', account: 'patrick@example.invalid', state: 'ready' }, { id: 'jev', provider: 'typesafe', account: '', state: 'ready' }], complete: true, owner: 'owner', runtime: { ready: true, error: null } }))
    installWorkspace({ runtimeApproval, mcpSession, onboarding, codex: async () => ({ state: 'connected', home: '', manual: '' }) } as never)
    applyLanguage('de')
    wrapper = mount(AppSettingsMenu, { attachTo: document.body }); await flushPromises()
    expect(account('ddisa').text()).toContain('DDISA-Konto')
    expect(account('ddisa').text()).toContain('angemeldet')
    expect(account('ddisa').text()).toContain('patrick@example.invalid · entscheidet alle Rechte')
    expect(account('codex').text()).toContain('Codex / GPT')
    expect(account('codex').text()).toContain('verbunden')
    expect(account('codex').text()).toContain('legt Automatisierungen an, schreibt Scripts')
    expect(account('jev').text()).toContain('TypeSafe Jev')
    expect(account('jev').text()).toContain('Entscheidungen in Scripts')
    const approval = wrapper.find('[data-switch="approval"]')
    expect((approval.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('[data-switch="mcp"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Scripts aller meiner Pods auf diesem Mac immer ausführen lassen')
    expect(wrapper.get('[data-mcp]').text()).toContain('MCP-Sitzung')
    expect(wrapper.get('[data-mcp]').text()).toContain('Codex angemeldet bis 16:45')
    await approval.setValue(false); await flushPromises()
    expect(runtimeApproval).toHaveBeenCalledWith({ type: 'set', enabled: false })
    await wrapper.get('[data-mcp] button').trigger('click'); await flushPromises()
    expect(mcpSession).toHaveBeenCalledWith({ type: 'end' })
    expect(wrapper.get('[data-mcp]').text()).toContain('Codex nicht angemeldet')
    expect(wrapper.find('[data-mcp] button').exists()).toBe(false)
    await wrapper.findAll('button').find(item => item.text() === 'Bestehende Grants am IdP verwalten')!.trigger('click'); await flushPromises()
    expect(runtimeApproval).toHaveBeenCalledWith({ type: 'manage' })
    expect(wrapper.text()).toContain('Sprache')
    expect(wrapper.findAll('button').map(item => item.text())).toContain('Sicherung exportieren …')
    await wrapper.find('.x').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows the signed-in subject with sign-out in the browser and points to the desktop for the rest', async () => {
    applyLanguage('de')
    wrapper = mount(AppSettingsMenu, { attachTo: document.body, props: { browser: true, subject: 'owner@example.invalid' } }); await flushPromises()
    expect(account('ddisa').text()).toContain('owner@example.invalid')
    expect(account('ddisa').text()).toContain('angemeldet')
    expect(account('codex').text()).toContain('am Desktop')
    expect(wrapper.find('[data-switch="approval"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-mcp]').text()).toContain('am Desktop')
    expect(wrapper.find('[data-mcp] button').exists()).toBe(false)
    expect(wrapper.find('a[href="https://id.openape.ai/grants"]').text()).toBe('Bestehende Grants am IdP verwalten')
    await wrapper.findAll('button').find(item => item.text() === 'Abmelden')!.trigger('click')
    expect(wrapper.emitted('logout')).toHaveLength(1)
  })

  it('opens from the gear of the shell and closes with Escape', async () => {
    installWorkspace()
    applyLanguage('de')
    wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: true, now: view.at, desktop: true } }); await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '⚙ Einstellungen')!.trigger('click'); await flushPromises()
    expect(wrapper.find('.app-settings-menu').exists()).toBe(true)
    expect(wrapper.emitted('settings')).toBeUndefined()
    await wrapper.find('.app-settings-menu').trigger('keydown', { key: 'Escape' }); await flushPromises()
    expect(wrapper.find('.app-settings-menu').exists()).toBe(false)
  })
})
