// @vitest-environment node
import { mkdtemp, realpath, rm, symlink, readlink } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { nodeHost } from '../../src/cli/node-host'
import { cliArguments } from '../../src/cli/arguments'
import { executeCli } from '../../src/cli/commands'
import { assertDesktopClosed } from '../../src/cli/profile'
import { parseCliRequest } from '../../src/contracts/cli'
import { PodDatabase } from '../../src/worker/storage/database'
import { ItemTagStore } from '../../src/worker/workspace/item-tags'
import type { CliClient } from '../../src/cli/client'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function directory() { const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-cli-unit-'))); roots.push(root); return root }

it('parses the four commands and refuses options that would silently broaden a run', () => {
  expect(cliArguments(['edit', 'abcd1234', '--tags', '', '--json'])).toMatchObject({ command: 'edit', id: 'abcd1234', tags: [], json: true })
  expect(cliArguments(['create', '--name', 'Example', '--script', 'pod-script.mjs'])).toMatchObject({ command: 'create', name: 'Example', script: 'pod-script.mjs' })
  for (const argv of [['run'], ['run', 'id', '--name', 'Changed'], ['create', '--lifecycle', 'active'], ['list', 'unexpected'], ['edit', 'id', '--owner'], ['run', 'id', '--profile', '']]) expect(() => cliArguments(argv)).toThrow()
  expect(() => parseCliRequest({ channel: 'scripts', command: { type: 'approveCredentials' } })).toThrow()
  expect(() => parseCliRequest({ channel: 'workspace', command: { type: 'pauseAll' } })).toThrow()
  expect(() => parseCliRequest({ channel: 'workspace', command: { type: 'list' }, owner: true })).toThrow()
})

it('creates, edits and clears tags durably while preserving the Pod ID and unrelated metadata', async () => {
  const root = await directory(); let store = new PodDatabase(root)
  const state = () => ({ pods: store.listPods(), tags: new ItemTagStore(store).view(true) })
  const client: CliClient = {
    close: async () => {},
    request: async (value) => {
      const request = parseCliRequest(value)
      if (request.channel === 'runs') return { runs: [], events: [] }
      if (request.channel !== 'workspace') throw new Error('Unexpected script request')
      const command = request.command
      if (command.type === 'create') store.createPod({ name: command.name })
      if (command.type === 'update') store.updatePod(command.id, command.revision, { name: command.name, lifecycle: command.lifecycle })
      if (command.type === 'tag') new ItemTagStore(store).execute(command)
      return state()
    },
  }
  const output = vi.fn(); const io = { output, progress: vi.fn(), signal: new AbortController().signal }
  try {
    await executeCli(cliArguments(['create', '--name', 'One small task', '--tags', 'dev,local']), client, io)
    const id = store.listPods()[0]!.id
    await executeCli(cliArguments(['edit', id, '--name', 'Renamed']), client, io)
    expect(new ItemTagStore(store).own(id)).toEqual(['dev', 'local'])
    await executeCli(cliArguments(['edit', id, '--tags', '']), client, io)
    store.close(); store = new PodDatabase(root)
    await executeCli(cliArguments(['list']), client, io)
    expect(output).toHaveBeenLastCalledWith({ pods: [expect.objectContaining({ id, name: 'Renamed', lifecycle: 'paused', tags: [], lastRun: null })] })
    await expect(executeCli(cliArguments(['edit', id]), client, io)).rejects.toThrow('outside a terminal')
    await executeCli(cliArguments(['edit', id, '--tags', 'archived-tag']), client, io)
    await executeCli(cliArguments(['edit', id, '--lifecycle', 'archived', '--tags', 'retained']), client, io)
    expect(output).toHaveBeenLastCalledWith(expect.objectContaining({ id, lifecycle: 'archived', tags: ['retained'] }))
    expect(new ItemTagStore(store).view()).toEqual([])
    expect(store.listPods()).toHaveLength(1)
  }
  finally { store.close() }
})

it('refuses an active desktop lock without modifying it and permits a missing lock', async () => {
  const root = await directory()
  await assertDesktopClosed(root)
  const value = `${hostname()}-${process.pid}`
  await symlink(value, join(root, 'SingletonLock'))
  await expect(assertDesktopClosed(root)).rejects.toThrow('Close OpenApe Pods')
  expect(await readlink(join(root, 'SingletonLock'))).toBe(value)
})

it('cancels only the selected run and returns the cancellation exit code', async () => {
  const podId = '00000000-0000-4000-8000-000000000001'; const runId = '00000000-0000-4000-8000-000000000002'
  const controller = new AbortController(); let cancelled = false
  const request = vi.fn(async (value) => {
    if (value.channel === 'workspace') return { pods: [{ id: podId, name: 'Selected', revision: 1, lifecycle: 'paused', activeScript: 'a'.repeat(64) }] }
    if (value.command.type === 'start') return { runId }
    if (value.command.type === 'cancel') { cancelled = true; return {} }
    return { events: [], runs: [{ id: runId, podId, scriptHash: 'a'.repeat(64), state: cancelled ? 'cancelled' : 'running', startedAt: 1, finishedAt: cancelled ? 2 : null, summary: '', error: null, checkpointRevision: 0, recovery: null }] }
  })
  const output = vi.fn()
  const exit = await executeCli(cliArguments(['run', podId]), { request, close: async () => {} }, { output, signal: controller.signal, progress: () => controller.abort() })
  expect(exit).toBe(130)
  expect(request).toHaveBeenCalledWith({ channel: 'runs', command: { type: 'cancel', podId, runId } })
  expect(output).toHaveBeenCalledWith(expect.objectContaining({ id: runId, state: 'cancelled' }))
})

it('drains paged run events before printing the final result', async () => {
  const podId = '00000000-0000-4000-8000-000000000001'; const runId = '00000000-0000-4000-8000-000000000002'
  const events = Array.from({ length: 5 }, (_, index) => ({ sequence: index + 1, type: 'log', data: `message ${index + 1}`, at: 1 }))
  const request = vi.fn(async (value) => {
    if (value.channel === 'workspace') return { pods: [{ id: podId, name: 'Selected', revision: 1, lifecycle: 'paused', activeScript: 'a'.repeat(64) }] }
    if (value.command.type === 'start') return { runId }
    return { events: events.filter(event => event.sequence > value.command.after).slice(0, 2), runs: [{ id: runId, podId, scriptHash: 'a'.repeat(64), state: 'completed', startedAt: 1, finishedAt: 2, summary: 'Finished', error: null, checkpointRevision: 0, recovery: null }] }
  })
  const output = vi.fn(); const observed: number[] = []
  const exit = await executeCli(cliArguments(['run', podId]), { request, close: async () => {} }, { output, signal: new AbortController().signal, progress: (value) => { if ('sequence' in (value as object)) observed.push((value as { sequence: number }).sequence) } })
  expect(exit).toBe(0)
  expect(observed).toEqual([1, 2, 3, 4, 5])
  expect(output).toHaveBeenCalledTimes(1)
})

it('captures a supplied Jev key only in the CLI controller and removes inherited exposure', () => {
  const previous = process.env.JEV_API_KEY
  try {
    process.env.JEV_API_KEY = 'synthetic-env-key'
    const host = nodeHost('/synthetic-dist')
    expect(host.jevKey?.()).toBe('synthetic-env-key')
    expect(process.env.JEV_API_KEY).toBeUndefined()
    expect(JSON.stringify(host)).not.toContain('synthetic-env-key')
    expect(nodeHost('/synthetic-dist').jevKey?.()).toBeUndefined()
    process.env.JEV_API_KEY = 'invalid key'
    expect(() => nodeHost('/synthetic-dist')).toThrow('without whitespace')
    expect(process.env.JEV_API_KEY).toBeUndefined()
  }
  finally {
    if (previous === undefined) delete process.env.JEV_API_KEY
    else process.env.JEV_API_KEY = previous
  }
})

it('routes proxy status and administration without selecting or starting a Pod', async () => {
  const request = vi.fn(async () => ({ configured: false, enabled: false, available: false, mappings: [] }))
  const output = vi.fn()
  for (const [action, type] of [['status', 'proxyStatus'], ['reload', 'reloadProxy'], ['disable', 'disableProxy']] as const) {
    const args = cliArguments(['agent-backends', action, '--json'])
    expect(await executeCli(args, { request, close: async () => {} }, { output, progress: vi.fn(), signal: new AbortController().signal })).toBe(0)
    expect(request).toHaveBeenLastCalledWith({ channel: 'agentBackends', command: { type } })
    expect(parseCliRequest({ channel: 'agentBackends', command: { type } })).toEqual({ channel: 'agentBackends', command: { type } })
  }
  expect(request).toHaveBeenCalledTimes(3)
  for (const argv of [['agent-backends', 'login'], ['agent-backends', 'status', '--script', 'x'], ['agent-backends', 'status', '--name', 'x']]) expect(() => cliArguments(argv)).toThrow()
  expect(() => parseCliRequest({ channel: 'agentBackends', command: { type: 'connect', provider: 'chatgpt', account: '' } })).toThrow()
})
