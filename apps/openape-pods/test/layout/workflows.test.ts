import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import type { StoredPod } from '../../src/contracts/control'
import type { WorkflowView } from '../../src/contracts/workflows'
import { installWorkspace } from './workspace-fixture'

// Geometry and keyboard behaviour formerly asserted by the packaged
// `workflows` E2E. The graph comes from the worker in
// test/scheduling/workflow-graph-ui.test.ts; here only its layout matters.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const artifact = (name: string) => `../../.artifacts/${name}`
const hash = 'e'.repeat(64)
const members: StoredPod[] = ['Inbox filter', 'Important mail summary with a deliberately long name', 'Archive audit', 'Delivery confirmation'].map((name, index) => ({ id: `00000000-0000-4000-8000-00000000010${index}`, name, revision: 1, lifecycle: 'paused', activeScript: hash }))
const id = '00000000-0000-4000-8000-0000000001a0'
const nodes = members.map((pod, index) => ({ podId: pod.id, after: index === 0 ? [] : index === 3 ? [members[1]!.id, members[2]!.id] : [members[0]!.id], handoff: false }))
const definition = { id, revision: 1, name: 'Synthetic inbox workflow', nodes, schedule: { kind: 'cron' as const, expression: '0 9 * * 1-5', timezone: 'Europe/Vienna' }, enabled: false, paused: true, nextAt: null }
const completed: WorkflowView = { workflows: [definition], runs: [{ paused: false, id: '00000000-0000-4000-8000-0000000001b0', workflowId: id, revision: 1, state: 'completed', reason: null, startedAt: 1_790_000_000_000, finishedAt: 1_790_000_009_000, nodes: nodes.map((node, index) => ({ ...node, state: 'completed', runId: `00000000-0000-4000-8000-00000000011${index}`, reason: null, scriptHash: hash })) }] }
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en') })

async function open(view: WorkflowView) {
  installWorkspace({ workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: structuredClone(members) }), workflows: async () => structuredClone(view) })
  wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  await wrapper.findAll('button').find(button => button.text().trim() === 'Synthetic inbox workflow')!.trigger('click'); await flushPromises(); await frame()
}
async function show(width: number, scheme: 'light' | 'dark') {
  await page.viewport(width, 900); document.documentElement.style.colorScheme = scheme; await frame()
}

describe('workflow graph with the production stylesheet', () => {
  it('keeps every node readable and inside the window at 1060, 760 and 560 pixels', async () => {
    await open({ workflows: [definition], runs: [] })
    expect(document.querySelectorAll('.workflow-layer')).toHaveLength(3)
    for (const [width, scheme] of [[1060, 'light'], [760, 'light'], [560, 'dark']] as const) {
      await show(width, scheme)
      expect(document.documentElement.scrollWidth, `${width}: page overflow`).toBeLessThanOrEqual(innerWidth)
      const boxes = Array.from(document.querySelectorAll('.workflow-node')).map(node => node.getBoundingClientRect())
      expect(boxes).toHaveLength(4)
      for (const box of boxes) {
        expect(box.width, `${width}: node width`).toBeGreaterThanOrEqual(170)
        expect(box.right, `${width}: node inside window`).toBeLessThanOrEqual(innerWidth)
      }
      if (width !== 760) await page.screenshot({ path: artifact(`workflows-${width}.png`) })
    }
  })

  it('toggles a dependency with the keyboard and refuses to save a cycle', async () => {
    await open({ workflows: [definition], runs: [] })
    await show(1060, 'light')
    await wrapper!.findAll('button').find(button => button.text() === 'Edit workflow')!.trigger('click'); await flushPromises()
    const checkbox = document.querySelector<HTMLInputElement>('.workflow-dependencies input[type="checkbox"]')!
    checkbox.focus()
    await userEvent.keyboard(' '); await flushPromises()
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('cycle')
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    await userEvent.keyboard(' '); await flushPromises()
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  })

  it('shows a completed run and the German mail policy editor without widening the page', async () => {
    await open(completed)
    await show(1060, 'light')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    await page.screenshot({ path: artifact('workflows-completed.png') })
    wrapper!.unmount(); applyLanguage('de')
    await open(completed)
    await wrapper!.findAll('button').find(button => button.text() === 'Workflow bearbeiten')!.trigger('click'); await flushPromises()
    await wrapper!.findAll('label').find(label => label.text().includes('Mail-Filterung und Benachrichtigung konfigurieren'))!.get('input').setValue(true); await frame()
    expect(wrapper!.text()).toContain('Geschützte Kommunikationspartner')
    for (const width of [1060, 560]) {
      await show(width, width === 560 ? 'dark' : 'light')
      expect(document.documentElement.scrollWidth, `${width}: mail policy`).toBeLessThanOrEqual(innerWidth)
    }
    await show(1060, 'light')
    document.querySelector('.mail-workflow-settings')!.scrollIntoView()
    await page.screenshot({ path: artifact('workflows-mail-policy-de.png') })
  })
})
