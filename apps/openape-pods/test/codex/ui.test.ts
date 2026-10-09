import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../src/renderer/App.vue'
import CodexPanel from '../../src/renderer/CodexPanel.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { codexConversationId } from '../../src/contracts/codex'
import type { CodexConnection } from '../../src/contracts/codex'
import type { MasterView } from '../../src/contracts/master'
import { installWorkspace } from '../layout/workspace-fixture'

// Issue 1375: Codex settings; prepared changes stay out of the workspace.
afterEach(() => { document.body.innerHTML = ''; applyLanguage('en') })
const connection = (state: CodexConnection['state']): CodexConnection => ({ state, home: '/Users/owner/.codex', manual: 'codex mcp remove openape-pods' })
function review(): MasterView {
  return { conversation: { id: codexConversationId, revision: 2 } as MasterView['conversation'], activeConversationId: null, connected: true, state: 'idle', error: null, messages: [], drafts: [] }
}

it('connects and disconnects Codex and explains every registration state', async () => {
  const codex = vi.fn(async ({ type }: { type: string }) => connection(type === 'connect' ? 'connected' : 'disconnected'))
  installWorkspace({ codex })
  const panel = mount(CodexPanel); await flushPromises()
  expect(panel.text()).toContain('Not connected.'); expect(panel.text()).toContain('/Users/owner/.codex/config.toml')
  await panel.get('button').trigger('click'); await flushPromises()
  expect(codex).toHaveBeenLastCalledWith({ type: 'connect' })
  expect(panel.text()).toContain('Restart Codex once'); expect(panel.get('button').text()).toBe('Disconnect Codex')
  expect(panel.emitted('changed')!.at(-1)).toEqual([connection('connected')])
  for (const [state, text] of [['foreign', 'another server named openape-pods'], ['edited', 'codex mcp remove openape-pods']] as const) {
    installWorkspace({ codex: async () => connection(state) })
    const other = mount(CodexPanel); await flushPromises()
    expect(other.text()).toContain(text); expect(other.findAll('button')).toHaveLength(0)
  }
  applyLanguage('de'); installWorkspace({ codex: async () => { throw new Error('Codex configuration could not be read; check config.toml') } })
  const failed = mount(CodexPanel); await flushPromises()
  expect(failed.get('[role="alert"]').text()).toBe('Die Codex-Konfiguration konnte nicht gelesen werden; prüfe config.toml')
})

it('keeps chat and approval destinations out of the connected workspace', async () => {
  const master = vi.fn(async () => review())
  installWorkspace({ codex: async () => connection('connected'), master })
  const shown = mount(App, { props: { initialPodId: '00000000-0000-4000-8000-000000000001' } }); await flushPromises()
  expect(shown.text()).not.toContain('Prepared by Codex')
  expect(shown.findAll('[role="tab"]').map(tab => tab.text())).not.toContain('Chat')
  expect(shown.findAll('.nav-button').map(button => button.text())).not.toContain('Chats')
  expect(master).not.toHaveBeenCalled()

  shown.unmount()
})
