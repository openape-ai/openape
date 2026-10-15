import { afterEach, expect, it, vi } from 'vitest'
import { createDemoAdapter } from '../../src/renderer/demo/adapter'
import { demoId, scenarioNames } from '../../src/renderer/demo/scenarios'
import { parseWorkspace } from '../../src/contracts/control'
import { parsePodDetails } from '../../src/contracts/details'
import { parseMapView } from '../../src/contracts/map-view'
import { parseScriptView } from '../../src/contracts/scripts'
import { parseResourceState } from '../../src/contracts/resources'
import { parseRunView } from '../../src/contracts/runs'
import { parseScheduleView } from '../../src/contracts/scheduling'
import type { DomainOverview } from '../../src/contracts/domain-admin'
import { localWorkspaceAccess, browserWorkspaceAccess } from '../../src/renderer/workspace-access'
import { centralFixture } from './central-fixture'

let demo: ReturnType<typeof createDemoAdapter> | undefined
afterEach(() => { demo?.dispose(); demo = undefined; vi.useRealTimers() })

it.each(scenarioNames)('uses production view contracts for %s without a global native bridge', async (scenario) => {
  Reflect.deleteProperty(window, 'pods')
  demo = createDemoAdapter(scenario)
  demo.restoreConnection()
  const workspace = parseWorkspace(await demo.bridge.workspace({ type: 'map' }))
  const map = parseMapView(workspace.map)
  expect(map.pods.map(pod => pod.id)).toEqual(workspace.pods.map(pod => pod.id))
  for (const pod of workspace.pods) {
    expect(parsePodDetails(await demo.bridge.details({ type: 'list', podId: pod.id })).description?.text).toBeTruthy()
    expect(parseScriptView(await demo.bridge.scripts({ type: 'list', podId: pod.id })).pod.id).toBe(pod.id)
    expect(parseResourceState(await demo.bridge.resources({ type: 'list', podId: pod.id })).variables).toHaveLength(1)
    expect(parseRunView(await demo.bridge.runs({ type: 'list', podId: pod.id })).runs).toHaveLength(3)
    expect(parseScheduleView(await demo.bridge.scheduling({ type: 'list', podId: pod.id })).revision).toBe(1)
  }
  expect(window.pods).toBeUndefined()
})

it('confirms edits across views, rejects stale writes and returns detached snapshots', async () => {
  demo = createDemoAdapter('everyday')
  const bridge = demo.bridge; const podId = demoId(1)
  await bridge.details({ type: 'describe', podId, revision: 1, text: 'Updated purpose' })
  await bridge.scheduling({ type: 'lifecycle', podId, revision: 1, lifecycle: 'paused' })
  await bridge.resources({ type: 'saveVariable', podId, name: 'topic', value: 'updated', revision: 1 })
  await bridge.scheduling({ type: 'save', podId, revision: 1, spec: { kind: 'interval', seconds: 3600 }, enabled: true })
  const workspace = await bridge.workspace({ type: 'map' })
  expect(workspace.map!.pods[0]).toMatchObject({ description: 'Updated purpose', lifecycle: 'paused', schedule: { spec: { kind: 'interval', seconds: 3600 } } })
  expect((await bridge.resources({ type: 'list', podId })).variables![0]).toMatchObject({ value: 'updated', revision: 2 })
  await expect(bridge.details({ type: 'describe', podId, revision: 1, text: 'Stale purpose' })).rejects.toThrow('Revision conflict')
  workspace.pods[0]!.name = 'Mutated by caller'
  expect((await bridge.workspace({ type: 'list' })).pods[0]!.name).toBe('Rechnungseingang')
})

it('retains a refused choice, then applies single and grouped choices to counters', async () => {
  demo = createDemoAdapter('attention')
  const access = localWorkspaceAccess(demo.bridge)
  const command = { type: 'answer' as const, questionId: 'demo-question-1', option: 'archive' }
  await expect(access.domain!(command)).rejects.toThrow('Saving failed')
  expect((await access.read()).map!.kpis.decisions.filter(row => row.kind === 'question').reduce((sum, row) => sum + row.count, 0)).toBe(4)
  await access.domain!(command)
  const domain = await demo.bridge.domain({ type: 'list' }) as DomainOverview
  await Promise.all(domain.questions.map(question => access.domain!({ type: 'answer', questionId: question.id, option: 'keep' })))
  expect((await access.read()).map!.kpis.decisions.filter(row => row.kind === 'question')).toEqual([])
  expect((await demo.bridge.domain({ type: 'list' }) as DomainOverview).questions).toEqual([])
  await expect(access.domain!(command)).rejects.toThrow('already answered')
})

it('shows a running command before completion and cancels pending work when disposed', async () => {
  vi.useFakeTimers()
  demo = createDemoAdapter('everyday')
  const podId = demoId(1)
  await demo.bridge.runs({ type: 'start', podId })
  expect((await demo.bridge.runs({ type: 'list', podId })).runs[0]!.state).toBe('running')
  await vi.advanceTimersByTimeAsync(900)
  const completed = (await demo.bridge.runs({ type: 'list', podId })).runs[0]!
  expect(completed.state).toBe('completed')
  expect((await demo.bridge.runs({ type: 'list', podId, runId: completed.id })).events.at(-1)?.data).toEqual({ line: completed.summary })
  await demo.bridge.runs({ type: 'start', podId })
  demo.dispose()
  expect(vi.getTimerCount()).toBe(0)
  await expect(demo.bridge.runs({ type: 'list', podId })).rejects.toThrow('session ended')
})

it('aborts delayed reads and restores a recoverable read error explicitly', async () => {
  demo = createDemoAdapter('loading-error')
  await expect(demo.bridge.workspace({ type: 'map' })).rejects.toThrow('Demo connection')
  demo.restoreConnection()
  expect((await demo.bridge.workspace({ type: 'map' })).pods).toHaveLength(6)
  const pending = expect(demo.bridge.workspace({ type: 'map' })).rejects.toThrow('session ended')
  demo.dispose()
  await pending
})

it('makes native side effects explicit and keeps unavailable remote capabilities unavailable', async () => {
  const notify = vi.fn()
  demo = createDemoAdapter('attention', notify)
  await expect(demo.bridge.programs({ type: 'openFolder', podId: demoId(1) })).rejects.toThrow('Demo:')
  await demo.bridge.domain({ type: 'openApproval', id: demoId(900) })
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('No permission was granted'))
  const fixture = centralFixture()
  const dispatch = vi.fn(async () => 'confirmed')
  const browser = browserWorkspaceAccess(() => fixture.host, dispatch)
  const request = { channel: 'scheduling' as const, body: { type: 'lifecycle', podId: fixture.view.id, revision: 1, lifecycle: 'paused' } }
  expect(browser.desktop).toBe(false); expect(browser.domain).toBeUndefined()
  expect(await browser.command(request)).toBe('confirmed')
  expect(dispatch).toHaveBeenCalledWith(request)
  fixture.host.online = false
  await expect(browser.command(request)).rejects.toThrow('Desktop offline')
  expect(dispatch).toHaveBeenCalledOnce()
})
