// @vitest-environment node
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import type { CodexRequest } from '../../src/contracts/codex'
import { CodexControlServer } from '../../src/main/codex/server'
import type { McpSessionGate } from '../../src/main/codex/server'
import { McpOwnerSessions } from '../../src/main/codex/session'

// The socket the Codex MCP shim talks to: private to the user, one
// pods_control request per line, and nothing reaches the worker without the
// owner's session secret that was sent on that same connection.
let server: CodexControlServer | undefined; let root = ''
afterEach(async () => { await server?.stop(); server = undefined; if (root) await rm(root, { recursive: true, force: true }) })
const open: McpSessionGate = { authorize: () => {}, disconnect: () => {} }
async function start(execute: (request: CodexRequest) => Promise<unknown> = vi.fn(async request => ({ echoed: request.id })), sessions: McpSessionGate = open) {
  root = await mkdtemp(join(tmpdir(), 'pods-codex-socket-'))
  const endpoint = join(root, 'codex', 'control.sock')
  server = new CodexControlServer(endpoint, execute, sessions); await server.start()
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
type Frame = Record<string, unknown>
// A long-lived connection like the shim's: frames arrive in any order and are matched by id.
function client(endpoint: string) {
  const socket = connect(endpoint); const frames: Frame[] = []; let buffer = ''
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
  socket.on('data', (bytes) => {
    buffer += bytes.toString()
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) { frames.push(JSON.parse(buffer.slice(0, newline)) as Frame); buffer = buffer.slice(newline + 1) }
  })
  const take = (match: (frame: Frame) => boolean) => vi.waitFor(() => {
    const index = frames.findIndex(match)
    if (index < 0) throw new Error('No matching frame yet')
    return frames.splice(index, 1)[0]!
  })
  return {
    frames,
    closed,
    send: (action: Frame, session?: string) => { const id = randomUUID(); socket.write(`${JSON.stringify({ id, action, ...(session === undefined ? {} : { session }) })}\n`); return id },
    call: (action: Frame, session?: string) => { const id = randomUUID(); socket.write(`${JSON.stringify({ id, action, ...(session === undefined ? {} : { session }) })}\n`); return take(frame => frame.id === id) },
    take,
    session: async () => (await take(frame => frame.id === undefined && 'session' in frame)).session as string,
    end: () => { socket.destroy(); return closed },
  }
}
function owner(confirmations: boolean[] = []) {
  let now = 1_000_000
  const logins: AbortSignal[] = []
  let finish: () => void = () => {}
  const login = vi.fn((signal: AbortSignal) => { logins.push(signal); return new Promise<void>((resolve, reject) => { finish = resolve; signal.addEventListener('abort', () => reject(new Error('Sign-in aborted')), { once: true }) }) })
  const confirm = vi.fn(async () => confirmations.shift() ?? true)
  const sessions = new McpOwnerSessions({ login, confirm, now: () => now })
  return { sessions, login, confirm, logins, signIn: () => finish(), advance: (ms: number) => { now += ms } }
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

it('rejects review decisions, extra fields, malformed secrets and oversized input before the worker', async () => {
  const { endpoint, execute } = await start(); const id = randomUUID()
  for (const frame of [{ type: 'applyChanges', id, revision: 1 }, { id, action: { action: 'list' }, conversationId: id }, { id: 'not-a-uuid', action: { action: 'list' } }, { id, action: 'list' }, { id, action: { action: 'list' }, session: 7 }, { id, action: { action: 'list' }, session: 'x'.repeat(129) }]) {
    expect((await exchange(endpoint, `${JSON.stringify(frame)}\n`)).lines).toEqual([{ id: null, error: expect.stringContaining('Invalid Codex') }])
  }
  expect((await exchange(endpoint, 'x'.repeat(1024 * 1024 + 1))).closed).toBe(true)
  expect(execute).not.toHaveBeenCalled()
})

it('answers concurrent calls by id, reports worker refusals and closes a connection that reuses a running id', async () => {
  let release: () => void = () => {}
  const execute = vi.fn(async (request: CodexRequest) => {
    if (request.action.action === 'resume') throw new Error('This action requires owner review in Pod settings')
    if (request.action.action === 'run') await new Promise<void>((resolve) => { release = resolve })
    return { done: request.action.action }
  })
  const { endpoint } = await start(execute)
  const shim = client(endpoint)
  const slow = shim.send({ action: 'run' }); await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
  expect(await shim.call({ action: 'list' })).toMatchObject({ result: { done: 'list' } })
  expect(await shim.call({ action: 'resume' })).toMatchObject({ error: 'This action requires owner review in Pod settings' })
  release(); expect(await shim.take(frame => frame.id === slow)).toMatchObject({ result: { done: 'run' } })
  const line = JSON.stringify({ id: randomUUID(), action: { action: 'run' } })
  const socket = connect(endpoint); const closed = new Promise(resolve => socket.on('close', resolve))
  socket.write(`${line}\n`); await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4))
  socket.write(`${line}\n`); await closed
  expect(execute).toHaveBeenCalledTimes(4)
  release(); await shim.end()
})

it('refuses every call without the owner session with login_required and starts one browser sign-in', async () => {
  const fixture = owner(); const { endpoint, execute } = await start(undefined, fixture.sessions)
  const shim = client(endpoint)
  for (const action of [{ action: 'runtime' }, { action: 'list' }, { action: 'run' }]) expect(await shim.call(action)).toMatchObject({ code: 'login_required', error: expect.stringContaining('confirm the request in the OpenApe Pods app, then retry') })
  expect(await shim.call({ action: 'list' }, 'forged-secret')).toMatchObject({ code: 'login_required' })
  expect(fixture.login).toHaveBeenCalledOnce()
  expect(fixture.sessions.view()).toEqual({ expiresAt: null, pending: true })
  expect(execute).not.toHaveBeenCalled()
  await shim.end()
})

it('binds the session secret to the connection that signed in and to the owner confirmation', async () => {
  const fixture = owner(); const { endpoint, execute } = await start(undefined, fixture.sessions)
  const first = client(endpoint); const second = client(endpoint)
  await first.call({ action: 'list' })
  expect(await second.call({ action: 'list' })).toMatchObject({ code: 'login_required', error: expect.stringContaining('Another OpenApe Pods sign-in is waiting') })
  fixture.signIn()
  const secret = await first.session()
  expect(fixture.confirm).toHaveBeenCalledOnce()
  expect(second.frames.some(frame => 'session' in frame)).toBe(false)
  expect(fixture.sessions.view()).toEqual({ expiresAt: 1_000_000 + 3600000, pending: false })
  expect(await first.call({ action: 'list' }, secret)).toMatchObject({ result: { echoed: expect.any(String) } })
  expect(await second.call({ action: 'list' }, secret)).toMatchObject({ code: 'login_required' })
  expect(execute).toHaveBeenCalledOnce()
  // A wrong or missing secret on the bound connection ends that session instead of being retried.
  expect(await first.call({ action: 'list' })).toMatchObject({ code: 'login_required' })
  expect(await first.call({ action: 'list' }, secret)).toMatchObject({ code: 'login_required' })
  expect(execute).toHaveBeenCalledOnce()
  await first.end(); await second.end()
})

it('refuses an expired session and signs in again without a restart', async () => {
  const fixture = owner(); const { endpoint, execute } = await start(undefined, fixture.sessions)
  const shim = client(endpoint)
  await shim.call({ action: 'list' }); fixture.signIn(); const secret = await shim.session()
  fixture.advance(3600000 - 1)
  expect(await shim.call({ action: 'list' }, secret)).toMatchObject({ result: expect.anything() })
  fixture.advance(1)
  expect(await shim.call({ action: 'list' }, secret)).toMatchObject({ code: 'login_required' })
  expect(fixture.sessions.view()).toEqual({ expiresAt: null, pending: true })
  expect(fixture.login).toHaveBeenCalledTimes(2)
  fixture.signIn(); const renewed = await shim.session()
  expect(renewed).not.toBe(secret)
  expect(await shim.call({ action: 'list' }, secret)).toMatchObject({ code: 'login_required' })
  await shim.call({ action: 'list' }); fixture.signIn(); const third = await shim.session()
  expect(await shim.call({ action: 'list' }, third)).toMatchObject({ result: expect.anything() })
  expect(execute).toHaveBeenCalledTimes(2)
  await shim.end()
})

it('leaves no session when the owner declines, the sign-in fails or the connection closes during sign-in', async () => {
  const fixture = owner([false]); const { endpoint, execute } = await start(undefined, fixture.sessions)
  const shim = client(endpoint)
  await shim.call({ action: 'list' }); fixture.signIn()
  await vi.waitFor(() => expect(fixture.sessions.view().pending).toBe(false))
  expect(fixture.confirm).toHaveBeenCalledOnce()
  expect(shim.frames.some(frame => 'session' in frame)).toBe(false)
  fixture.login.mockRejectedValueOnce(new Error('Owner identity does not match the requested account'))
  expect(await shim.call({ action: 'list' })).toMatchObject({ code: 'login_required' })
  await vi.waitFor(() => expect(fixture.sessions.view().pending).toBe(false))
  expect(await shim.call({ action: 'list' })).toMatchObject({ code: 'login_required' })
  expect(fixture.sessions.view().pending).toBe(true)
  expect(fixture.confirm).toHaveBeenCalledOnce()
  await shim.end()
  await vi.waitFor(() => expect(fixture.logins.at(-1)!.aborted).toBe(true))
  await vi.waitFor(() => expect(fixture.sessions.view()).toEqual({ expiresAt: null, pending: false }))
  expect(fixture.confirm).toHaveBeenCalledOnce()
  expect(execute).not.toHaveBeenCalled()
})

it('ends every session and a waiting sign-in immediately on End session', async () => {
  const fixture = owner(); const { endpoint, execute } = await start(undefined, fixture.sessions)
  const shim = client(endpoint)
  await shim.call({ action: 'list' }); fixture.signIn(); const secret = await shim.session()
  expect(await shim.call({ action: 'list' }, secret)).toMatchObject({ result: expect.anything() })
  fixture.sessions.end()
  expect(fixture.sessions.view()).toEqual({ expiresAt: null, pending: false })
  expect(await shim.call({ action: 'list' }, secret)).toMatchObject({ code: 'login_required' })
  fixture.sessions.end()
  await vi.waitFor(() => expect(fixture.logins.at(-1)!.aborted).toBe(true))
  await vi.waitFor(() => expect(fixture.sessions.view().pending).toBe(false))
  expect(fixture.confirm).toHaveBeenCalledOnce()
  expect(execute).toHaveBeenCalledOnce()
  await shim.end()
})
