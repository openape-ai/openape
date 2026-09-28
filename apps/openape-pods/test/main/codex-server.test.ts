// @vitest-environment node
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import type { CodexRequest } from '../../src/contracts/codex'
import { CodexControlServer } from '../../src/main/codex/server'

// The socket the Codex MCP shim talks to: private to the user, one
// pods_control request per line, nothing else reaches the worker.
let server: CodexControlServer | undefined; let root = ''
afterEach(async () => { await server?.stop(); server = undefined; if (root) await rm(root, { recursive: true, force: true }) })
async function start(execute: (request: CodexRequest) => Promise<unknown> = vi.fn(async request => ({ echoed: request.id }))) {
  root = await mkdtemp(join(tmpdir(), 'pods-codex-socket-'))
  const endpoint = join(root, 'codex', 'control.sock')
  server = new CodexControlServer(endpoint, execute); await server.start()
  return { endpoint, execute }
}
function exchange(endpoint: string, payload: string): Promise<{ lines: unknown[], closed: boolean }> {
  return new Promise((resolve) => {
    const socket = connect(endpoint); let data = ''
    const finish = (closed: boolean) => { socket.destroy(); resolve({ lines: data.split('\n').filter(Boolean).map(line => JSON.parse(line) as unknown), closed }) }
    socket.on('data', (bytes) => { data += bytes.toString(); if (data.endsWith('\n')) finish(false) })
    socket.on('close', () => finish(true))
    socket.write(payload)
  })
}

it('is reachable only by the owner account', async () => {
  const { endpoint } = await start()
  expect((await stat(endpoint)).mode & 0o777).toBe(0o600)
  expect((await stat(join(root, 'codex'))).mode & 0o777).toBe(0o700)
})

it('forwards exactly one pods_control request and returns its result', async () => {
  const { endpoint, execute } = await start(); const id = randomUUID()
  expect((await exchange(endpoint, `${JSON.stringify({ id, action: { action: 'list' } })}\n`)).lines).toEqual([{ id, result: { echoed: id } }])
  expect(execute).toHaveBeenCalledWith({ id, action: { action: 'list' } })
})

it('rejects review decisions, extra fields and oversized input before the worker', async () => {
  const { endpoint, execute } = await start(); const id = randomUUID()
  for (const frame of [{ type: 'applyChanges', id, revision: 1 }, { id, action: { action: 'list' }, conversationId: id }, { id: 'not-a-uuid', action: { action: 'list' } }, { id, action: 'list' }]) {
    expect((await exchange(endpoint, `${JSON.stringify(frame)}\n`)).lines).toEqual([{ id: null, error: expect.stringContaining('Invalid Codex') }])
  }
  expect((await exchange(endpoint, 'x'.repeat(1024 * 1024 + 1))).closed).toBe(true)
  expect(execute).not.toHaveBeenCalled()
})

it('reports worker refusals to Codex and closes a connection that pipelines requests', async () => {
  const execute = vi.fn(async () => { throw new Error('This action requires owner review in Pod settings') })
  const { endpoint } = await start(execute); const id = randomUUID()
  expect((await exchange(endpoint, `${JSON.stringify({ id, action: { action: 'resume' } })}\n`)).lines).toEqual([{ id, error: 'This action requires owner review in Pod settings' }])
  const slow = vi.fn(() => new Promise(() => {}))
  await server!.stop(); server = new CodexControlServer(endpoint, slow); await server.start()
  const line = JSON.stringify({ id, action: { action: 'list' } })
  expect((await exchange(endpoint, `${line}\n${line}\n`)).closed).toBe(true)
  expect(slow).not.toHaveBeenCalled()
  const socket = connect(endpoint); const closed = new Promise(resolve => socket.on('close', resolve))
  socket.write(`${line}\n`); await vi.waitFor(() => expect(slow).toHaveBeenCalledOnce())
  socket.write(`${line}\n`); await closed
  expect(slow).toHaveBeenCalledOnce()
})

it('applies access policy to socket requests and closes idle connections on revocation', async () => {
  const { McpAccessPolicy } = await import('../../src/main/codex/access')
  let policy: InstanceType<typeof McpAccessPolicy>
  const worker = vi.fn(async () => ({ pods: [] }))
  const { endpoint } = await start(vi.fn(async (request) => { policy.assert(request); return worker() }))
  policy = new McpAccessPolicy(root)
  const call = (action: string) => exchange(endpoint, `${JSON.stringify({ id: randomUUID(), action: { action } })}\n`)
  expect((await call('list')).lines[0]).toMatchObject({ error: expect.stringContaining('off') })
  policy.set('read', 'hour')
  expect((await call('list')).lines[0]).toMatchObject({ result: { pods: [] } })
  expect((await call('run')).lines[0]).toMatchObject({ error: expect.stringContaining('read-only') })
  expect(worker).toHaveBeenCalledOnce()
  const socket = connect(endpoint)
  await new Promise<void>(resolve => socket.once('connect', resolve))
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
  policy.set('off', 'hour'); await server!.stop(); await closed
  expect(socket.destroyed).toBe(true)
})
