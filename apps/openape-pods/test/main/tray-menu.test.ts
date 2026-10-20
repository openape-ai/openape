// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import type { StoredPod } from '../../src/contracts/control'
import type { RunRecord, RunState } from '../../src/contracts/runs'
import { channels } from '../../src/contracts/ipc'
import { trayPodItems } from '../../src/main/tray-menu'
import { startMain } from './app-harness'
import type { MainHarness } from './app-harness'

const pod = (name: string): StoredPod => ({ id: name, name, revision: 1, lifecycle: 'active', activeScript: null })
function run(state: RunState, startedAt = Date.UTC(2026, 9, 20, 10, 30)): RunRecord {
  return {
    id: 'run',
    podId: 'pod',
    scriptHash: '',
    state,
    startedAt,
    finishedAt: null,
    summary: '',
    error: null,
    checkpointRevision: 0,
    recovery: null,
  }
}
let main: MainHarness | undefined
afterEach(async () => { await main?.close(); main = undefined })

it('sorts every Pod by name, including paused and archived Pods, and shows the latest run start', () => {
  const entries = [
    { pod: pod('Zulu'), runs: [] },
    { pod: { ...pod('alpha 10'), lifecycle: 'archived' as const }, runs: [run('completed')] },
    { pod: { ...pod('Alpha 2'), lifecycle: 'paused' as const }, runs: [run('completed', 1), run('failed')] },
  ]
  const open = vi.fn()
  const items = trayPodItems(entries, 'de', open)
  expect(items.map(item => item.id)).toEqual(['Alpha 2', 'alpha 10', 'Zulu'])
  const date = new Intl.DateTimeFormat('de', { dateStyle: 'short', timeStyle: 'short' }).format(run('failed').startedAt)
  expect(items.map(item => item.label)).toEqual([
    `🔴 Alpha 2 — Letzte Ausführung: ${date}`,
    `🟢 alpha 10 — Letzte Ausführung: ${date}`,
    '⚪ Zulu — Noch nie gelaufen',
  ])
  expect(entries[0]!.pod.name).toBe('Zulu')
  expect(items.every(item => item.click === open)).toBe(true)
})

it.each([
  ['completed', '🟢'],
  ['failed', '🔴'],
  ['running', '🟡'],
  ['completedWithGaps', '🟠'],
  ['blocked', '🟠'],
  ['cancelled', '🟠'],
  ['interrupted', '🟠'],
] as const)('shows %s distinctly from a never-run Pod', (state, indicator) => {
  expect(trayPodItems([{ pod: pod('Pod'), runs: [run(state)] }], 'en', vi.fn())[0]!.label).toMatch(`${indicator} Pod — Last run:`)
})

it('reloads the tray on left and right clicks, using the current language and latest worker data', async () => {
  main = await startMain()
  main.openTray()
  expect(main.tray()[0]!.label).toBe('Loading')
  expect(main.worker.request).not.toHaveBeenCalled()
  main.worker.publish({ state: 'ready', pid: 1, error: null })
  main.worker.request.mockResolvedValue({ pods: [pod('Zulu'), pod('Alpha')] })
  main.worker.runs.mockResolvedValue({ runs: [run('running')], events: [] })
  main.openTray()
  await vi.waitFor(() => expect(main!.tray()[0]!.label).toMatch('🟡 Alpha'))
  expect(main.tray()).toHaveLength(2)
  expect(main.worker.runs).toHaveBeenCalledWith({ type: 'list', podId: 'Zulu' })
  await main.invoke(channels.language, { type: 'set', language: 'de' })
  main.worker.request.mockResolvedValue({ pods: [pod('Renamed')] })
  main.worker.runs.mockResolvedValue({ runs: [run('failed')], events: [] })
  main.openTray('right-click')
  await vi.waitFor(() => expect(main!.tray()[0]!.label).toMatch('🔴 Renamed — Letzte Ausführung:'))
  expect(main.tray()).toHaveLength(1)
})

it('shows empty, failed and unavailable states without presenting stale run results', async () => {
  main = await startMain()
  main.worker.publish({ state: 'ready', pid: 1, error: null })
  main.worker.request.mockResolvedValue({ pods: [] })
  main.openTray()
  await vi.waitFor(() => expect(main!.tray()[0]!.label).toBe('No pods yet'))
  main.worker.request.mockResolvedValue({ pods: [pod('Pod')] })
  main.worker.runs.mockRejectedValueOnce(new Error('Worker response timed out'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  main.openTray()
  await vi.waitFor(() => expect(main!.tray()[0]!.label).toBe('Could not load Pods'))
  expect(log).toHaveBeenCalledWith('Could not load Pods tray', expect.objectContaining({ message: 'Worker response timed out' }))
  log.mockRestore()
  main.worker.publish({ state: 'error', pid: null, error: 'Worker stopped' })
  main.openTray()
  expect(main.tray()[0]!.label).toBe('Pods unavailable')
})
