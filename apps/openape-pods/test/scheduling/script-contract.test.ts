// @vitest-environment node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { graphEmitter, parseGraphContract, syntheticGraphItems } from '../../src/contracts/graphs'
import { parseFrame } from '../../src/contracts/runs'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { validateDraft } from '../../src/worker/master/validation'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { executeScript } from '../../src/worker/runs/runner'
import { PodDatabase } from '../../src/worker/storage/database'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const roots: string[] = []
const stores: PodDatabase[] = []
function temporary(): string { const root = mkdtempSync(join(tmpdir(), 'pods-contract-')); roots.push(root); return root }
afterEach(() => {
  vi.clearAllMocks()
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const contract = { takes: ['mail.open'], gives: ['mail.newsletter', 'mail.useful'], summary: 'Sorts mail' }
const emit = { channel: 'mail.useful', key: 'message-1@v1', data: { subject: 'Invoice' } }

describe('script contract', () => {
  it('accepts a contract and copies only its three fields', () => {
    expect(parseGraphContract(contract)).toEqual(contract)
    expect(parseGraphContract({ takes: [], gives: [], summary: 'Source' })).toEqual({ takes: [], gives: [], summary: 'Source' })
  })
  it.each([
    ['an unknown field', { ...contract, rights: ['archive'] }, 'Invalid graph contract'],
    ['a channel name taken from data', { ...contract, gives: ['Mail Open'] }, 'Invalid graph contract'],
    ['a repeated channel', { ...contract, gives: ['mail.useful', 'mail.useful'] }, 'unique'],
    ['more than 8 taken channels', { ...contract, takes: Array.from({ length: 9 }, (_, index) => `mail.c${index}`) }, 'Invalid graph contract'],
    ['more than 16 given channels', { ...contract, gives: Array.from({ length: 17 }, (_, index) => `mail.c${index}`) }, 'Invalid graph contract'],
    ['a missing summary', { takes: [], gives: [] }, 'summary of at most 40 characters'],
    ['an overlong summary', { ...contract, summary: 'x'.repeat(41) }, 'summary of at most 40 characters'],
    ['a value that is no object', 'mail.open', 'Invalid graph contract'],
  ])('refuses %s', (_name, value, message) => {
    expect(() => parseGraphContract(value)).toThrow(message)
  })
  it('supplies two synthetic items for every taken channel', () => {
    expect(syntheticGraphItems({ ...contract, takes: ['mail.open', 'mail.sent'] }).map(item => `${item.channel}:${item.key}`)).toEqual(['mail.open:synthetic-1', 'mail.open:synthetic-2', 'mail.sent:synthetic-1', 'mail.sent:synthetic-2'])
    expect(syntheticGraphItems({ ...contract, takes: [] })).toEqual([])
  })
})

describe('graph.emit', () => {
  it('accepts a declared channel with reason and confidence', () => {
    expect(graphEmitter(contract)({ ...emit, reason: 'Known sender', confidence: 0.9 })).toEqual({ ...emit, reason: 'Known sender', confidence: 0.9 })
  })
  it.each([
    ['a channel outside the contract', { ...emit, channel: 'mail.archive' }, 'The script emits a channel missing from its contract'],
    ['a payload above 1,024 bytes', { ...emit, data: { subject: 'x'.repeat(1024) } }, 'Item payload exceeds 1,024 bytes'],
    ['a reason above 500 characters', { ...emit, reason: 'x'.repeat(501) }, 'Emit reason exceeds 500 characters'],
    ['a confidence above 1', { ...emit, confidence: 1.1 }, 'Invalid graph emit'],
    ['a confidence that is no number', { ...emit, confidence: Number.NaN }, 'Invalid graph emit'],
    ['an empty key', { ...emit, key: '' }, 'Invalid graph emit'],
    ['a key above 200 characters', { ...emit, key: 'x'.repeat(201) }, 'Invalid graph emit'],
    ['a key with a control character', { ...emit, key: 'a\nb' }, 'Invalid graph emit'],
    ['a payload that is a list', { ...emit, data: [] }, 'Invalid graph emit'],
    ['an unknown field', { ...emit, grant: 'archive' }, 'Invalid graph emit'],
  ])('refuses %s', (_name, payload, message) => {
    expect(() => graphEmitter(contract)(payload)).toThrow(message)
  })
  it('refuses every emit of a script without a contract', () => {
    expect(() => graphEmitter(undefined)(emit)).toThrow('Script declares no contract')
  })
  it('refuses the same key twice on one channel but not on another', () => {
    const check = graphEmitter(contract)
    check(emit)
    expect(() => check(emit)).toThrow('The item was already emitted to this channel')
    expect(check({ ...emit, channel: 'mail.newsletter' }).channel).toBe('mail.newsletter')
  })
  it('refuses the 501st emit of one run and does not count refusals', () => {
    const check = graphEmitter(contract)
    expect(() => check({ ...emit, channel: 'mail.archive' })).toThrow()
    for (let index = 0; index < 500; index++) check({ ...emit, key: `message-${index}` })
    expect(() => check({ ...emit, key: 'message-500' })).toThrow('A run supports at most 500 emits')
  })
  it('is an allowed script operation', () => {
    for (const operation of ['graph.contract', 'graph.emit']) expect(parseFrame({ version: 1, runId: 'run', sequence: 1, type: 'request', id: 'request-1', operation, payload: {} }, 'run', 1).operation).toBe(operation)
  })
})

type Script = (request: (operation: string, payload: unknown) => Promise<unknown>) => Promise<void>
async function validate(script: Script) {
  const store = new PodDatabase(temporary()); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Sorter' }); const draft = randomUUID()
  store.db.prepare('INSERT INTO script_drafts VALUES(?,?,?,?,?,?,NULL,NULL)').run(draft, pod.id, 1, pod.bindingRevision, 'export async function run() {}', '[]')
  const manifest = join(store.root, 'runtime.json'); writeFileSync(manifest, JSON.stringify({ dependencyLockHash: 'a'.repeat(64) }))
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    await script((operation, payload) => hooks.request(operation, payload, signal))
    return { status: 'completed', summary: 'done', completedInputIds: input.eventIds, gapIds: [] }
  })
  const stored = () => store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').all(pod.id).map(row => JSON.parse(String(row.manifest)))
  const checked = () => store.db.prepare('SELECT script_hash FROM script_drafts WHERE id=?').get(draft)?.script_hash
  return { stored, checked, run: () => validateDraft(store, resources, { manifest, helper: '/unused', environment: {} } as unknown as AgentRuntime, draft, 1, new AbortController().signal) }
}

describe('validation', () => {
  it('validates a script without a contract exactly as before', async () => {
    const draft = await validate(async () => {})
    const { hash } = await draft.run()
    expect(draft.checked()).toBe(hash)
    expect(draft.stored()).toHaveLength(1)
    expect(Object.keys(draft.stored()[0])).toEqual(['schemaVersion', 'contentHash', 'entrypoint', 'dependencyLockHash', 'runtimeVersion', 'capabilities', 'triggers', 'inputSchemaHash', 'outputSchemaHash', 'checkpointSchemaVersion', 'assignmentRevision', 'effects'])
  })
  it('stores the contract and hands two synthetic items per taken channel to the script', async () => {
    let items: unknown
    const draft = await validate(async (request) => {
      items = await request('graph.contract', contract)
      await request('graph.emit', emit)
    })
    await draft.run()
    expect(items).toEqual([{ key: 'synthetic-1', channel: 'mail.open', data: {} }, { key: 'synthetic-2', channel: 'mail.open', data: {} }])
    expect(draft.stored()[0].contract).toEqual(contract)
  })
  it('refuses a script that emits an undeclared channel, even when the script ignores the refusal', async () => {
    const draft = await validate(async (request) => {
      await request('graph.contract', contract)
      try { await request('graph.emit', { ...emit, channel: 'mail.archive' }) }
      catch {}
    })
    await expect(draft.run()).rejects.toThrow('The script emits a channel missing from its contract')
    expect(draft.stored()).toEqual([])
    expect(draft.checked()).toBeNull()
  })
  it('refuses an emit from a script without a contract', async () => {
    const draft = await validate(async (request) => { await request('graph.emit', emit) })
    await expect(draft.run()).rejects.toThrow('Script declares no contract')
    expect(draft.stored()).toEqual([])
  })
  it('refuses an invalid contract and a second contract', async () => {
    const invalid = await validate(async (request) => { await request('graph.contract', { ...contract, summary: '' }) })
    await expect(invalid.run()).rejects.toThrow('summary of at most 40 characters')
    expect(invalid.stored()).toEqual([])
    const twice = await validate(async (request) => { await request('graph.contract', contract); await request('graph.contract', { ...contract, gives: ['mail.archive'] }) })
    await expect(twice.run()).rejects.toThrow('Invalid graph contract')
    expect(twice.stored()).toEqual([])
  })
})

async function dispatch(stored: unknown, script: Script) {
  const store = new PodDatabase(temporary()); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Sorter' })
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const row = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!
  store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=?').run(JSON.stringify({ ...JSON.parse(String(row.manifest)), contract: stored }), pod.id)
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    await script((operation, payload) => hooks.request(operation, payload, signal))
    return { status: 'completed', summary: 'done', completedInputIds: input.eventIds, gapIds: [] }
  })
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime)
  const id = dispatcher.start(pod.id)
  await vi.waitFor(() => expect(dispatcher.runs.get(id).state).not.toBe('running'))
  vi.restoreAllMocks()
  const emits = store.db.prepare('SELECT data FROM run_events WHERE run_id=? AND type=\'emit\'').all(id).map(row => JSON.parse(String(row.data)))
  return { run: dispatcher.runs.get(id), emits }
}

describe('run', () => {
  it('records a declared emit and gives the script no items before item flow exists', async () => {
    let items: unknown
    const { run, emits } = await dispatch(contract, async (request) => { items = await request('graph.contract', contract); await request('graph.emit', emit) })
    expect(run.state).toBe('completed')
    expect(items).toEqual([])
    expect(emits).toEqual([{ channel: 'mail.useful', key: 'message-1@v1' }])
  })
  it('fails on an undeclared channel and records nothing', async () => {
    const { run, emits } = await dispatch(contract, async (request) => { await request('graph.emit', { ...emit, channel: 'mail.archive' }) })
    expect(run).toMatchObject({ state: 'failed', error: 'The script emits a channel missing from its contract' })
    expect(emits).toEqual([])
  })
  it('fails when the script announces another contract than the validated one', async () => {
    const { run } = await dispatch(contract, async (request) => { await request('graph.contract', { ...contract, gives: ['mail.archive'] }) })
    expect(run).toMatchObject({ state: 'failed', error: 'Script contract changed since validation' })
  })
})

interface Frame { type: string, id?: string, operation?: string, payload: unknown }
/** Runs the real script entry in a child process and answers its requests like the runner does. */
async function runEntry(code: string, reply: (frame: Frame) => unknown): Promise<Frame[]> {
  const root = temporary(); const entry = join(root, 'run.mjs'); const config = join(root, 'input.json'); const runId = randomUUID()
  writeFileSync(entry, code)
  writeFileSync(config, JSON.stringify({ entry, input: { runId, eventIds: [], limits: { timeMs: 5000, frameBytes: 256 * 1024 }, workspace: root, references: [] } }))
  const child = spawn(process.execPath, [resolve('src/worker/runs/script-entry.ts'), config], { stdio: ['ignore', 'inherit', 'inherit', 'pipe'] })
  const channel = child.stdio[3] as Duplex; const frames: Frame[] = []; let buffer = ''
  channel.setEncoding('utf8')
  channel.on('data', (text: string) => {
    buffer += text
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      const frame = JSON.parse(buffer.slice(0, newline)) as Frame; buffer = buffer.slice(newline + 1)
      frames.push(frame)
      if (frame.type !== 'request') continue
      try { channel.write(`${JSON.stringify({ version: 1, runId, id: frame.id, ok: true, value: reply(frame) })}\n`) }
      catch (error) { channel.write(`${JSON.stringify({ version: 1, runId, id: frame.id, ok: false, error: (error as Error).message })}\n`) }
    }
  })
  await new Promise(done => child.on('close', done))
  return frames
}
const done = 'return { status: \'completed\', summary: \'done\', completedInputIds: [], gapIds: [] }'

describe('script context', () => {
  it('announces the contract, passes the items and sends every emit as graph.emit', async () => {
    const check = graphEmitter(contract)
    const frames = await runEntry(`export const contract = ${JSON.stringify(contract)}
export async function run(context) {
  if (!Object.isFrozen(context.items) || !Object.isFrozen(context.items[0].data)) throw new Error('Items are mutable')
  for (const item of context.items) await context.emit('mail.useful', { key: item.key, data: { from: item.channel }, reason: 'Known sender', confidence: 0.9 })
  ${done}
}`, frame => frame.operation === 'graph.contract' ? syntheticGraphItems(parseGraphContract(frame.payload)) : check(frame.payload))
    expect(frames.map(frame => frame.operation ?? frame.type)).toEqual(['graph.contract', 'graph.emit', 'graph.emit', 'result'])
    expect(frames[0]!.payload).toEqual(contract)
    expect(frames[1]!.payload).toEqual({ channel: 'mail.useful', key: 'synthetic-1', data: { from: 'mail.open' }, reason: 'Known sender', confidence: 0.9 })
  })
  it('passes the refusal of an undeclared channel to the script', async () => {
    const check = graphEmitter(contract)
    const frames = await runEntry(`export const contract = ${JSON.stringify(contract)}
export async function run(context) {
  await context.emit('mail.archive', { key: 'message-1', data: {} })
  ${done}
}`, frame => frame.operation === 'graph.contract' ? [] : check(frame.payload))
    expect(frames.at(-1)).toMatchObject({ type: 'error', payload: { message: 'The script emits a channel missing from its contract' } })
  })
  it('sends no graph request for a script without a contract and gives it no items', async () => {
    const frames = await runEntry(`export async function run(context) {
  if (context.items.length !== 0 || typeof context.emit !== 'function') throw new Error('Unexpected graph context')
  ${done}
}`, () => { throw new Error('Unexpected request') })
    expect(frames.map(frame => frame.type)).toEqual(['result'])
  })
})
