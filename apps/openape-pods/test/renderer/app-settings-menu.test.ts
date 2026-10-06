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

// The gear menu: three account rows, two execution switches, language, backups and the grants link.
const view = parseMapView(fixture) as MapView
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals(); applyLanguage('en') })
const account = (name: string) => wrapper!.find(`[data-account="${name}"]`)

describe('Settings menu', () => {
  it('shows the three accounts and both execution switches on the desktop and sends the switches as commands', async () => {
    const runtimeApproval = vi.fn(async (command: { type: string, enabled?: boolean }) => ({ enabled: command.type === 'set' ? !!command.enabled : true, standing: false, owner: 'patrick@example.invalid', scope: null }))
    const mcpAccess = vi.fn(async (command: { type: string, mode?: string, duration?: string }) => ({ mode: command.type === 'set' ? command.mode! : 'off', duration: 'day', expiresAt: null }))
    const onboarding = vi.fn(async () => ({ connections: [{ id: 'owner', provider: 'openape', account: 'patrick@example.invalid', state: 'ready' }, { id: 'jev', provider: 'typesafe', account: '', state: 'ready' }], complete: true, owner: 'owner', runtime: { ready: true, error: null } }))
    installWorkspace({ runtimeApproval, mcpAccess, onboarding, codex: async () => ({ state: 'connected', home: '', manual: '' }) } as never)
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
    const approval = wrapper.find('[data-switch="approval"]'); const mcp = wrapper.find('[data-switch="mcp"]')
    expect((approval.element as HTMLInputElement).checked).toBe(true)
    expect((mcp.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('Scripts aller meiner Pods auf diesem Mac immer ausführen lassen')
    expect(wrapper.text()).toContain('Lokaler MCP-Zugriff für verbundene Werkzeuge')
    await approval.setValue(false); await flushPromises()
    expect(runtimeApproval).toHaveBeenCalledWith({ type: 'set', enabled: false })
    await mcp.setValue(true); await flushPromises()
    expect(mcpAccess).toHaveBeenCalledWith({ type: 'set', mode: 'write', duration: 'day' })
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
    expect(wrapper.find('[data-switch="mcp"]').attributes('disabled')).toBeDefined()
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
