import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../src/renderer/App.vue'
import CodexPanel from '../../src/renderer/CodexPanel.vue'
import CodexReviews from '../../src/renderer/CodexReviews.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { codexConversationId } from '../../src/contracts/codex'
import type { CodexConnection } from '../../src/contracts/codex'
import type { ChangeSet } from '../../src/contracts/control-api'
import type { MasterView } from '../../src/contracts/master'
import { installWorkspace, podId } from '../layout/workspace-fixture'

// Issue 1375: Codex settings and the review view where the owner applies what
// their Codex prepared.
afterEach(() => { document.body.innerHTML = ''; applyLanguage('en') })
const connection = (state: CodexConnection['state']): CodexConnection => ({ state, home: '/Users/owner/.codex', manual: 'codex mcp remove openape-pods' })
const pending: ChangeSet = { id: '00000000-0000-4000-8000-0000000000c1', conversationId: codexConversationId, contextRevision: 2, revision: 3, kind: 'changes', state: 'pending', error: null, results: [], targets: [{ podId, name: 'Mail knowledge', base: 'x', before: {}, draftHashes: {}, actions: [{ action: 'setVariable', podId, revision: 2, name: 'recipient', value: 'ops@example.invalid', variableRevision: 0 }], review: [{ action: 'setVariable: recipient', before: '', after: 'ops@example.invalid', evidence: null }] }] }
function review(changes: ChangeSet[]): MasterView {
  return { changes, conversation: { id: codexConversationId, revision: 2 } as MasterView['conversation'], activeConversationId: null, connected: true, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }
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

it('applies a prepared change only on the owner\'s click, with the exact review identity', async () => {
  const master = vi.fn(async (command: { type: string }) => command.type === 'list' ? review([pending]) : review([{ ...pending, state: 'applied' }]))
  installWorkspace({ master })
  const view = mount(CodexReviews); await flushPromises()
  expect(master).toHaveBeenCalledTimes(1); expect(view.emitted('changed')![0]).toEqual([1])
  expect(view.text()).toContain('ops@example.invalid')
  await view.findAll('button').find(button => button.text() === 'Apply changes together')!.trigger('click'); await flushPromises()
  expect(master).toHaveBeenLastCalledWith({ type: 'applyChanges', id: pending.id, revision: 3, conversationId: codexConversationId, contextRevision: 2 })
  expect(view.emitted('changed')!.at(-1)).toEqual([0])
})

it('shows an empty review before Codex prepared anything', async () => {
  installWorkspace({ master: async () => { throw new Error('Conversation not found') } })
  const view = mount(CodexReviews); await flushPromises()
  expect(view.get('[role="status"]').text()).toBe('Nothing is waiting for you.'); expect(view.find('[role="alert"]').exists()).toBe(false)
})

it('lists Prepared by Codex with its waiting count only while Codex is connected', async () => {
  const master = async (command: { type: string, conversationId?: string }) => command.conversationId === codexConversationId ? review([pending]) : review([])
  installWorkspace({ codex: async () => connection('disconnected'), master })
  const hidden = mount(App); await flushPromises()
  expect(hidden.text()).not.toContain('Prepared by Codex'); hidden.unmount()
  installWorkspace({ codex: async () => connection('connected'), master })
  const shown = mount(App); await flushPromises()
  const entry = shown.findAll('.nav-button').find(button => button.text().startsWith('Prepared by Codex'))!
  expect(entry.get('.codex-badge').text()).toBe('1')
  shown.unmount()
})
