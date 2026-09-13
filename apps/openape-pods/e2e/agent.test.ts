import { mkdtemp, realpath, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentRuntime } from '../src/worker/agent/executor'
import { executeAgent } from '../src/worker/agent/executor'
import { recordedResponse } from './fixtures/responses'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
async function setup(packaged = false): Promise<AgentRuntime> {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-sdk-')))
  if (packaged) {
    const bundle = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents'); const dist = join(bundle, 'Resources/app.asar.unpacked/dist')
    return { helper: join(dist, 'native/pods-helper'), executable: join(bundle, 'MacOS/OpenApe Pods Fixture'), entry: join(dist, 'runtime/script-entry.mjs'), runtimeDirectories: [bundle], environment: { ELECTRON_RUN_AS_NODE: '1' }, binary: join(dist, 'vendor/codex'), catalog: join(dist, 'vendor/models.json'), manifest: join(dist, 'vendor/manifest.json'), sdkHost: join(dist, 'runtime/sdk-host.mjs') }
  }
  return { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') }
}
describe('pinned SDK native boundary', () => {
  it.each([false, true])('streams the actual Codex CLI through the SDK with a fresh context (packaged=%s)', async (packaged) => {
    const runtime = await setup(packaged); const events: unknown[] = []; const requests: unknown[] = []
    const services = { provider: async (body: unknown) => { requests.push(body); return recordedResponse() }, tool: async () => { throw new Error('No tools assigned') } }
    const first = await executeAgent(runtime, root, 'Synthetic transport fixture, no model connected.', [], services, new AbortController().signal, event => events.push(event))
    expect(first.response).toBe('SYNTHETIC_RESPONSE_COMPLETE')
    const second = await executeAgent(runtime, root, 'A separate synthetic run.', [], services, new AbortController().signal, () => {})
    expect(first.threadId).not.toBe(second.threadId)
    expect(events).toContainEqual(expect.objectContaining({ type: 'turn.completed' }))
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests)).not.toContain('SYNTHETIC_OWNER')
  })
  it('routes only ape-shell calls to the assigned broker callback', async () => {
    const runtime = await setup(); let turns = 0; const calls: unknown[] = []
    const reply = await executeAgent(runtime, root, 'Synthetic tool transport.', [], { provider: async () => ++turns === 1 ? recordedResponse({ type: 'function_call', id: 'fixture-call', call_id: 'fixture-call', namespace: 'mcp__pod', name: 'ape_shell', arguments: JSON.stringify({ toolId: 'fixture', argv: ['fixture', 'read'] }) }) : recordedResponse(), tool: async (body) => { calls.push(body); return { text: 'SYNTHETIC_ALLOWED' } } }, new AbortController().signal, () => {})
    expect(reply.response).toBe('SYNTHETIC_RESPONSE_COMPLETE'); expect(calls).toEqual([{ toolId: 'fixture', argv: ['fixture', 'read'] }]); expect(turns).toBe(2)
  })
  it.each(['exec_command', 'apply_patch', 'spawn_agent', 'view_image'])('denies a model-forced built-in %s call', async (name) => {
    const runtime = await setup(); let turns = 0; const requests: unknown[] = []; const calls: unknown[] = []
    const marker = join(root, 'unassigned-output')
    const services = {
      provider: async (body: unknown) => {
        requests.push(body)
        if (++turns > 2) throw new Error('Unexpected repeated model request')
        return turns === 1 ? recordedResponse({ type: 'function_call', id: 'denied-call', call_id: 'denied-call', namespace: 'functions', name, arguments: JSON.stringify({ cmd: `/usr/bin/touch ${marker}`, input: `*** Begin Patch\n*** Add File: ${marker}\n+BAD\n*** End Patch`, message: 'Create an unassigned file', path: marker }) }) : recordedResponse()
      },
      tool: async (body: unknown) => { calls.push(body); throw new Error('No assigned capability') },
    }
    const result = await executeAgent(runtime, root, 'Synthetic forbidden tool call.', [], services, new AbortController().signal, () => {})
    expect(result.response).toBe('SYNTHETIC_RESPONSE_COMPLETE')
    expect(calls).toHaveLength(0)
    expect(JSON.stringify(requests[1])).toMatch(/unknown|unsupported|not available|not found/i)
    await expect(access(marker)).rejects.toThrow()
  })
  it('cancels a real SDK process while its provider response is pending', async () => {
    const runtime = await setup(); const controller = new AbortController()
    let markRequested: () => void = () => {}
    const requested = new Promise<void>((resolveRequest) => { markRequested = resolveRequest })
    const running = executeAgent(runtime, root, 'Synthetic stalled provider.', [], {
      provider: async (_body, signal) => { markRequested(); return new Promise<Response>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }) },
      tool: async () => { throw new Error('No tools assigned') },
    }, controller.signal, () => {})
    const settled = expect(running).rejects.toThrow('Owner cancelled')
    await requested; controller.abort(new Error('Owner cancelled')); await settled
  })

})
