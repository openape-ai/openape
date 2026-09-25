import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import WorkflowPanel from '../../src/renderer/WorkflowPanel.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { parseWorkflowView } from '../../src/contracts/workflows'
import { PodDatabase } from '../../src/worker/storage/database'
import { WorkflowEngine } from '../../src/worker/workflows/engine'

// Formerly the packaged `workflows` E2E: the diamond graph is saved through the
// real WorkflowEngine and rendered from the worker's own view. Execution order
// and unchanged members are proven in test/scheduling/workflows.test.ts; widths
// and keyboard toggling in test/layout/workflows.test.ts.
let root = ''
afterEach(async () => { applyLanguage('en'); if (root) await rm(root, { recursive: true, force: true }) })
async function diamond() {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-workflow-graph-'))); const store = new PodDatabase(root)
  const pods = ['Inbox filter', 'Important mail summary', 'Archive audit', 'Delivery confirmation'].map(name => store.createPod({ name }))
  const engine = new WorkflowEngine(store, { start: () => { throw new Error('Rendering must not execute pods') }, cancelPod: () => {} }, { inspect: async () => {} })
  const id = randomUUID()
  engine.save({ type: 'save', id, revision: 0, name: 'Synthetic inbox workflow', nodes: pods.map((pod, index) => ({ podId: pod.id, after: index === 0 ? [] : index === 3 ? [pods[1]!.id, pods[2]!.id] : [pods[0]!.id], handoff: false })), schedule: { kind: 'cron', expression: '0 9 * * 1-5', timezone: 'Europe/Vienna' }, enabled: false })
  const view = parseWorkflowView(structuredClone(engine.view())); const list = store.listPods(); store.close()
  window.pods = { workflows: vi.fn().mockResolvedValue(view), workspace: vi.fn(), scripts: vi.fn(), scheduling: vi.fn(), resources: vi.fn().mockResolvedValue({ resources: [], epoch: 0 }) } as unknown as typeof window.pods
  return { view, pods: list, id }
}

it('renders the saved fan-out/fan-in graph in dependency layers', async () => {
  const { view, pods, id } = await diamond()
  const wrapper = mount(WorkflowPanel, { props: { view, pods, selectedId: id } })
  const layers = wrapper.findAll('.workflow-layer')
  expect(layers.map(layer => layer.findAll('.workflow-node').length)).toEqual([1, 2, 1])
  expect(layers[1]!.text()).toContain('Important mail summary')
  expect(layers[1]!.text()).toContain('Archive audit')
  expect(layers[2]!.text()).toContain('Delivery confirmation')
  wrapper.unmount()
})

it('shows the German mail policy editor when mail filtering is configured', async () => {
  applyLanguage('de')
  const { view, pods, id } = await diamond()
  const wrapper = mount(WorkflowPanel, { props: { view, pods, selectedId: id } })
  await wrapper.findAll('button').find(button => button.text() === 'Workflow bearbeiten')!.trigger('click')
  const toggle = wrapper.findAll('label').find(label => label.text().includes('Mail-Filterung und Benachrichtigung konfigurieren'))!.get('input')
  await toggle.setValue(true)
  expect(wrapper.text()).toContain('Geschützte Kommunikationspartner')
  wrapper.unmount()
})
