// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import type { StoredPod } from '../../src/contracts/control'
import type { RunRecord, RunState } from '../../src/contracts/runs'
import { channels } from '../../src/contracts/ipc'
import { trayPodItems } from '../../src/main/tray-menu'
import { startMain } from './app-harness'
import type { MainHarness } from './app-harness'
import { TrayPreference } from '../../src/main/tray-preference'

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
  await vi.waitFor(() => expect(main!.tray()[2]!.label).toMatch('🟡 Alpha'))
  expect(main.tray()).toHaveLength(4)
  expect(main.worker.runs).toHaveBeenCalledWith({ type: 'list', podId: 'Zulu' })
  await main.invoke(channels.language, { type: 'set', language: 'de' })
  main.worker.request.mockResolvedValue({ pods: [pod('Renamed')] })
  main.worker.runs.mockResolvedValue({ runs: [run('failed')], events: [] })
  main.openTray('right-click')
  await vi.waitFor(() => expect(main!.tray()[2]!.label).toMatch('🔴 Renamed — Letzte Ausführung:'))
  expect(main.tray()).toHaveLength(3)
})

it('shows empty, failed and unavailable states without presenting stale run results', async () => {
  main = await startMain()
  main.worker.publish({ state: 'ready', pid: 1, error: null })
  main.worker.request.mockResolvedValue({ pods: [] })
  main.openTray()
  await vi.waitFor(() => expect(main!.tray()[2]!.label).toBe('No pods yet'))
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

function chooseTag(label: string): void {
  const items = main!.tray()[0]!.submenu as MenuItemConstructorOptions[]
  const item = items.find(item => item.label === label)!
  expect(item).toBeDefined()
  ;(item.click as () => void)()
}

it('filters by one tag, preserves sorting and status, and remembers the selection across restart', async () => {
  main = await startMain()
  main.worker.publish({ state: 'ready', pid: 1, error: null })
  const workspace = {
    pods: [pod('Zulu'), pod('Alpha'), pod('Untagged')],
    tags: [{ id: 'Zulu', tags: ['mail', 'zaz'], revision: 1 }, { id: 'Alpha', tags: ['mail'], revision: 1 }],
  }
  main.worker.request.mockResolvedValue(workspace)
  main.worker.runs.mockResolvedValue({ runs: [run('completed')], events: [] })
  main.openTray()
  await vi.waitFor(() => expect(main!.tray()).toHaveLength(5))
  expect((main.tray()[0]!.submenu as MenuItemConstructorOptions[]).map(item => item.label)).toEqual(['All Pods', 'mail', 'zaz'])
  chooseTag('mail')
  await vi.waitFor(() => expect(main!.tray()[0]!.label).toBe('Tags: mail'))
  expect(main.tray().slice(2).map(item => item.id)).toEqual(['Alpha', 'Zulu'])
  expect(main.tray()[2]!.label).toMatch('🟢 Alpha — Last run:')
  expect(new TrayPreference(main.root).tag).toBe('mail')
  const saved = await readFile(join(main.root, 'tray-tag.json'), 'utf8')
  await main.close()
  main = await startMain({}, root => writeFile(join(root, 'tray-tag.json'), saved))
  main.worker.publish({ state: 'ready', pid: 1, error: null })
  main.worker.request.mockResolvedValue(workspace)
  main.worker.runs.mockResolvedValue({ runs: [], events: [] })
  main.openTray()
  await vi.waitFor(() => expect(main!.tray()[0]!.label).toBe('Tags: mail'))
  expect(main.tray().slice(2).map(item => item.id)).toEqual(['Alpha', 'Zulu'])
  expect(main.worker.runs).not.toHaveBeenCalledWith({ type: 'list', podId: 'Untagged' })
  chooseTag('All Pods')
  await vi.waitFor(() => expect(main!.tray().slice(2)).toHaveLength(3))
  expect(new TrayPreference(main.root).tag).toBeNull()
})

it('refreshes tags and resets a removed selection while retaining archived matches', async () => {
  main = await startMain({}, root => writeFile(join(root, 'tray-tag.json'), '"mail"'))
  main.worker.publish({ state: 'ready', pid: 1, error: null })
  main.worker.request.mockResolvedValue({ pods: [{ ...pod('Archived'), lifecycle: 'archived' }], tags: [{ id: 'Archived', tags: ['mail'], revision: 1 }, { id: 'deleted-pod', tags: ['orphan'], revision: 1 }] })
  main.worker.runs.mockResolvedValue({ runs: [], events: [] })
  main.openTray()
  await vi.waitFor(() => expect(main!.tray()[2]!.id).toBe('Archived'))
  expect((main.tray()[0]!.submenu as MenuItemConstructorOptions[]).map(item => item.label)).toEqual(['All Pods', 'mail'])
  main.worker.request.mockResolvedValue({ pods: [pod('New')], tags: [] })
  main.openTray()
  await vi.waitFor(() => expect(main!.tray()[2]!.id).toBe('New'))
  expect(new TrayPreference(main.root).tag).toBeNull()
  expect((main.tray()[0]!.submenu as MenuItemConstructorOptions[])[0]!.checked).toBe(true)
})

it('keeps the saved filter when writing fails and recovers malformed preferences without stopping startup', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    main = await startMain({}, root => writeFile(join(root, 'tray-tag.json'), '{broken'))
    expect(log).toHaveBeenCalledWith('Could not read Pods tray filter', expect.any(Error))
    main.worker.publish({ state: 'ready', pid: 1, error: null })
    main.worker.request.mockResolvedValue({ pods: [pod('Mail')], tags: [{ id: 'Mail', tags: ['mail'], revision: 1 }] })
    main.worker.runs.mockResolvedValue({ runs: [], events: [] })
    main.openTray()
    await vi.waitFor(() => expect(main!.tray()[2]!.id).toBe('Mail'))
    new TrayPreference(main.root).set(null)
    await mkdir(join(main.root, 'tray-tag.json.tmp'))
    chooseTag('mail')
    await vi.waitFor(() => expect(main!.dialog.showErrorBox).toHaveBeenCalledWith('Could not save tray filter', expect.any(String)))
    expect(new TrayPreference(main.root).tag).toBeNull()
    await vi.waitFor(() => expect(main!.tray()[0]!.label).toBe('Tags'))
  }
  finally { log.mockRestore() }
})
