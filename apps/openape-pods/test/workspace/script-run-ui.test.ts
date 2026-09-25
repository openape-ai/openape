import { randomUUID } from 'node:crypto'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../src/renderer/App.vue'
import PodScript from '../../src/renderer/PodScript.vue'
import type { ScriptCommand, ScriptView } from '../../src/contracts/scripts'
import { installWorkspace } from '../layout/workspace-fixture'

// Behaviour formerly asserted by the packaged `script-editor` E2E. Native
// validation itself is proven in e2e/master.test.ts; here the editor's own
// contract: which worker commands a Run produces, in which order, and what it
// refuses to do after a failed check.
const active = 'a'.repeat(64); const validated = 'b'.repeat(64)
function editor(failValidation = false) {
  const pod = { id: randomUUID(), name: 'Order review', revision: 1, lifecycle: 'paused' as const, activeScript: active }
  const draftId = randomUUID(); const commands: ScriptCommand[] = []
  let view: ScriptView = { resourceEpoch: 0, credentialAliases: [], pod, versions: [{ hash: active, assignmentRevision: 1, validated: true, active: true }], drafts: [], source: { kind: 'version', id: active, code: 'export async function run() {}', capabilities: [], revision: 0, assignmentRevision: 1, hash: active, validated: true, evidence: null, credentialAccessApproved: true } }
  const scripts = vi.fn(async (command: ScriptCommand) => {
    commands.push(command)
    if (command.type === 'save') view = { ...view, source: { ...view.source!, kind: 'draft', id: draftId, code: command.code, revision: 1, hash: null, validated: false } }
    if (command.type === 'validate') { if (failValidation) throw new Error('Script check failed: Unexpected token'); view = { ...view, source: { ...view.source!, hash: validated, validated: true, evidence: 'native-synthetic-contract' } } }
    if (command.type === 'activate') view = { ...view, pod: { ...view.pod, activeScript: command.hash } }
    return structuredClone(view)
  })
  const runs = vi.fn(async () => ({ runs: [], events: [] }))
  window.pods = { scripts, runs, resources: async () => ({ resources: [], variables: [{ name: 'topic', value: 'Orders', revision: 1 }], epoch: 0 }) } as unknown as typeof window.pods
  return { pod, commands, runs }
}
async function click(wrapper: ReturnType<typeof mount>, name: string) { await wrapper.findAll('button').find(button => button.text() === name)!.trigger('click'); await flushPromises() }
afterEach(() => {
  try { localStorage.clear() }
  catch {}
})

it('runs an edited script only after saving, validating and activating exactly that version', async () => {
  const { pod, commands, runs } = editor()
  const wrapper = mount(PodScript, { props: { pod } }); await flushPromises()
  await wrapper.get('textarea').setValue('export async function run(context) { return { status: "completed", summary: "Edited", completedInputIds: [], gapIds: [] } }')
  await click(wrapper, 'Save and run')
  expect(commands.map(command => command.type)).toEqual(['list', 'save', 'validate', 'activate'])
  expect(commands[3]).toMatchObject({ type: 'activate', hash: validated, expectedActive: active })
  expect(runs).toHaveBeenCalledWith({ type: 'start', podId: pod.id, expectedScript: validated })
  wrapper.unmount()
})

it('stops a run at a failed check without activating or starting anything', async () => {
  const { pod, commands, runs } = editor(true)
  const wrapper = mount(PodScript, { props: { pod } }); await flushPromises()
  await wrapper.get('textarea').setValue('export async function run( { syntax error')
  await click(wrapper, 'Save and run')
  expect(commands.map(command => command.type)).toEqual(['list', 'save', 'validate'])
  expect(runs).not.toHaveBeenCalled()
  expect(wrapper.get('[role="alert"]').text()).toContain('Unexpected token')
  wrapper.unmount()
})

it('confirms a saved draft and offers the reference for each variable', async () => {
  const { pod } = editor()
  const wrapper = mount(PodScript, { props: { pod } }); await flushPromises()
  await wrapper.get('textarea').setValue('export async function run() { return null }')
  await click(wrapper, 'Save script')
  expect(wrapper.text()).toContain('Draft saved. Validate it before activation.')
  expect(wrapper.findAll('input').map(input => (input.element as HTMLInputElement).value)).toContain('context.variables["topic"]')
  wrapper.unmount()
})

it('resizes the sidebar with the keyboard, remembers the width and collapses the navigation', async () => {
  installWorkspace()
  let wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  const divider = () => wrapper.get('[role="separator"]')
  expect(divider().attributes('aria-valuenow')).toBe('224')
  await divider().trigger('keydown', { key: 'ArrowRight' })
  expect(divider().attributes('aria-valuenow')).toBe('240')
  wrapper.unmount()
  wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  expect(divider().attributes('aria-valuenow')).toBe('240')
  await wrapper.get('button[aria-label="Collapse sidebar"]').trigger('click')
  expect(wrapper.get('.workspace').classes()).toContain('sidebar-collapsed')
  expect(wrapper.find('[role="separator"]').exists()).toBe(false)
  await wrapper.get('button[aria-label="Expand sidebar"]').trigger('click')
  expect(wrapper.get('.workspace').classes()).not.toContain('sidebar-collapsed')
  expect(wrapper.findAll('.pod-button').map(button => button.text())).toEqual(expect.arrayContaining([expect.stringContaining('Mail knowledge')]))
  wrapper.unmount()
})
