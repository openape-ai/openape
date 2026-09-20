import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import WorkflowPanel from '../../src/renderer/WorkflowPanel.vue'
import type { WorkflowView } from '../../src/contracts/workflows'

const pods = [1, 2, 3].map(index => ({ id: `00000000-0000-4000-8000-00000000000${index}`, name: ['Filter inbox', 'Important mail', 'Archive audit'][index - 1]!, revision: 1, lifecycle: 'paused' as const, activeScript: 'a'.repeat(64) }))
const id = '00000000-0000-4000-8000-000000000010'
const view: WorkflowView = { workflows: [{ id, name: 'Inbox workflow', revision: 1, nodes: pods.map((pod, index) => ({ podId: pod.id, after: index ? [pods[0]!.id] : [], handoff: false })), enabled: false, paused: true, schedule: null, nextAt: null }], runs: [] }
it('creates explicit dependencies without editing pods and prevents cycle submission', async () => {
  const workflows = vi.fn().mockResolvedValue(view)
  const workspace = vi.fn(); const scripts = vi.fn(); const scheduling = vi.fn()
  window.pods = { workflows, workspace, scripts, scheduling } as unknown as typeof window.pods
  const wrapper = mount(WorkflowPanel, { props: { view, pods, selectedId: id } })
  await wrapper.findAll('button').find(button => button.text() === 'Edit workflow')!.trigger('click')
  expect(wrapper.findAll('.workflow-dependencies')).toHaveLength(3)
  await wrapper.findAll('.workflow-dependencies')[0]!.find('input[type=checkbox]').setValue(true)
  expect(wrapper.get('[role=alert]').text()).toContain('cycle')
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
  await wrapper.findAll('.workflow-dependencies')[0]!.find('input[type=checkbox]').setValue(false)
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(workflows).toHaveBeenCalledWith({ type: 'save', id, name: view.workflows[0]!.name, revision: 1, nodes: view.workflows[0]!.nodes, schedule: null, enabled: false })
  expect(workspace).not.toHaveBeenCalled(); expect(scripts).not.toHaveBeenCalled(); expect(scheduling).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('shows blocking reasons and routes retry through the workflow while retaining completed siblings', async () => {
  const runId = '00000000-0000-4000-8000-000000000011'
  const state: WorkflowView = { ...view, runs: [{ paused: false, id: runId, workflowId: id, revision: 1, state: 'blocked', reason: 'Review blocked nodes before continuing', startedAt: 1000, finishedAt: null, nodes: view.workflows[0]!.nodes.map((node, index) => ({ ...node, state: index === 0 ? 'completed' : index === 1 ? 'blocked' : 'waiting', reason: index === 1 ? 'Synthetic transport outcome unknown' : null, scriptHash: 'a'.repeat(64), runId: null })) }] }
  const workflows = vi.fn().mockResolvedValue(state)
  window.pods = { workflows } as unknown as typeof window.pods
  const wrapper = mount(WorkflowPanel, { props: { view: state, pods, selectedId: id } })
  expect(wrapper.text()).toContain('Synthetic transport outcome unknown')
  expect(wrapper.findAll('button').filter(button => button.text() === 'Retry blocked node')).toHaveLength(1)
  await wrapper.findAll('button').find(button => button.text() === 'Retry blocked node')!.trigger('click'); await flushPromises()
  expect(workflows).toHaveBeenCalledWith({ type: 'retry', runId, podId: pods[1]!.id })
  wrapper.unmount()
})
it('keeps an unsaved graph intact when history polling supplies a newer revision', async () => {
  window.pods = { chats: async () => ({ conversations: [], activeConversationId: null }), workflows: vi.fn() } as unknown as typeof window.pods
  const wrapper = mount(WorkflowPanel, { props: { view, pods, selectedId: id } })
  await wrapper.findAll('button').find(button => button.text() === 'Edit workflow')!.trigger('click')
  await wrapper.get('input[maxlength="100"]').setValue('Unsaved owner edit')
  await wrapper.setProps({ view: { ...view, workflows: [{ ...view.workflows[0]!, name: 'Concurrent update', revision: 2 }] } })
  expect((wrapper.get('input[maxlength="100"]').element as HTMLInputElement).value).toBe('Unsaved owner edit')
  wrapper.unmount()
})
it('offers pause for a manual run even when its automatic workflow is paused', async () => {
  const state: WorkflowView = { ...view, runs: [{ paused: false, id: '00000000-0000-4000-8000-000000000011', workflowId: id, revision: 1, state: 'running', reason: null, startedAt: 1000, finishedAt: null, nodes: [] }] }
  const workflows = vi.fn().mockResolvedValue(state); window.pods = { workflows } as unknown as typeof window.pods
  const wrapper = mount(WorkflowPanel, { props: { view: state, pods, selectedId: id } })
  await wrapper.findAll('button').find(button => button.text() === 'Pause workflow')!.trigger('click'); await flushPromises()
  expect(workflows).toHaveBeenCalledWith({ type: 'pause', id, revision: 1, paused: true })
  expect(wrapper.text()).toContain('Schedule off')
  wrapper.unmount()
})
