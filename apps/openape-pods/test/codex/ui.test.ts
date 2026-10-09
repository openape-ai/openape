import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../src/renderer/App.vue'
import RuntimeApprovalSettings from '../../src/renderer/RuntimeApprovalSettings.vue'
import CodexPanel from '../../src/renderer/CodexPanel.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { codexConversationId } from '../../src/contracts/codex'
import type { CodexConnection } from '../../src/contracts/codex'
import type { ChangeSet } from '../../src/contracts/control-api'
import type { MasterView } from '../../src/contracts/master'
import { installWorkspace, podId } from '../layout/workspace-fixture'

// Issue 1375: Codex settings; prepared changes stay out of the workspace.
afterEach(() => { document.body.innerHTML = ''; applyLanguage('en') })
const connection = (state: CodexConnection['state']): CodexConnection => ({ state, home: '/Users/owner/.codex', manual: 'codex mcp remove openape-pods' })
const pending: ChangeSet = { id: '00000000-0000-4000-8000-0000000000c1', conversationId: codexConversationId, contextRevision: 2, revision: 3, kind: 'changes', state: 'pending', error: null, results: [], targets: [{ podId, name: 'Mail knowledge', base: 'x', before: {}, draftHashes: {}, actions: [{ action: 'setVariable', podId, revision: 2, name: 'recipient', value: 'ops@example.invalid', variableRevision: 0 }], review: [{ action: 'setVariable: recipient', before: '', after: 'ops@example.invalid', evidence: null }] }] }
function review(changes: ChangeSet[]): MasterView {
  return { changes, conversation: { id: codexConversationId, revision: 2 } as MasterView['conversation'], activeConversationId: null, connected: true, state: 'idle', error: null, messages: [], drafts: [] }
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
  const master = vi.fn(async () => review([pending]))
  installWorkspace({ codex: async () => connection('connected'), master })
  const shown = mount(App, { props: { initialPodId: '00000000-0000-4000-8000-000000000001' } }); await flushPromises()
  expect(shown.text()).not.toContain('Prepared by Codex')
  expect(shown.findAll('[role="tab"]').map(tab => tab.text())).not.toContain('Chat')
  expect(shown.findAll('.nav-button').map(button => button.text())).not.toContain('Chats')
  expect(master).not.toHaveBeenCalled()

  shown.unmount()
})

it('persists the owner checkbox and restores its checked state after reopening', async () => {
  let enabled = false
  const runtimeApproval = vi.fn(async (command: { type: string, enabled?: boolean }) => {
    if (command.type === 'set') enabled = command.enabled!
    return { enabled, standing: false, owner: 'owner@example.test', scope: 'a'.repeat(64) }
  })
  installWorkspace({ runtimeApproval })
  const view = mount(RuntimeApprovalSettings); await flushPromises()
  expect(view.get<HTMLInputElement>('.runtime-approval-option input').element.checked).toBe(false)
  await view.get<HTMLInputElement>('.runtime-approval-option input').setValue(true); await flushPromises()
  expect(runtimeApproval).toHaveBeenLastCalledWith({ type: 'set', enabled: true })
  expect(view.get<HTMLInputElement>('.runtime-approval-option input').element.checked).toBe(true)
  view.unmount()
  const reopened = mount(RuntimeApprovalSettings); await flushPromises()
  expect(reopened.get<HTMLInputElement>('.runtime-approval-option input').element.checked).toBe(true)
  runtimeApproval.mockRejectedValueOnce(new Error('Disk is read-only'))
  await reopened.get<HTMLInputElement>('.runtime-approval-option input').setValue(false); await flushPromises()
  expect(reopened.get<HTMLInputElement>('.runtime-approval-option input').element.checked).toBe(true)
  expect(reopened.get('[role="alert"]').text()).toContain('Disk is read-only')
  reopened.unmount()
})

it('keeps standing consent separate and opens existing grant management without changing consent', async () => {
  let standing = false
  const runtimeApproval = vi.fn(async (command: { type: string, enabled?: boolean }) => {
    if (command.type === 'setStanding') standing = command.enabled!
    return { enabled: false, standing, owner: 'owner@example.test', scope: 'a'.repeat(64) }
  })
  installWorkspace({ runtimeApproval })
  const view = mount(RuntimeApprovalSettings); await flushPromises()
  await view.get('.standing-runtime-option input').setValue(true); await flushPromises()
  expect(runtimeApproval).toHaveBeenLastCalledWith({ type: 'setStanding', enabled: true, scope: 'a'.repeat(64) })
  expect((view.get<HTMLInputElement>('.runtime-approval-option input').element as HTMLInputElement).checked).toBe(false)
  await view.get('.manage-runtime-grants').trigger('click'); await flushPromises()
  expect(runtimeApproval).toHaveBeenLastCalledWith({ type: 'manage' })
  expect((view.get('.standing-runtime-option input').element as HTMLInputElement).checked).toBe(true)
  expect(view.text()).toContain('Existing approvals remain valid')
  view.unmount()
})
