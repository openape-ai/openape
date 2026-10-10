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
const open: McpSessionGate = { authorize: async () => {}, status: () => ({ state: 'signed_out', via: null, expiresAt: null }), owner: () => null, disconnect: () => {} }
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
  const login = vi.fn((_endsAt: number, signal: AbortSignal) => { logins.push(signal); return new Promise<null>((resolve, reject) => { finish = () => resolve(null); signal.addEventListener('abort', () => reject(new Error('Sign-in aborted')), { once: true }) }) })
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
  expect(execute).toHaveBeenCalledWith({ id, action: { action: 'list' } }, null)
})

it('records owner evidence of every MCP call as an assistant request without refusing it', async () => {
  const { endpoint, execute } = await start()
  const networkId = randomUUID(); const reconcile = randomUUID()
  const near = 'x'.repeat(1995)
  for (const action of [
    { action: 'networks', command: { type: 'gateReview', id: networkId, revision: 1, taskId: networkId, generation: 1, evidence: 'Failed before the IdP was contacted' } },
    { action: 'workspace', query: { type: 'reconcile', id: reconcile, applied: true, evidence: near } },
    { action: 'recovery', revision: 1, command: { type: 'resolveHttp', podId: networkId, runId: networkId, key: 'send', applied: false, evidence: '' } },
  ]) await exchange(endpoint, `${JSON.stringify({ id: randomUUID(), action })}\n`)
  const sent = vi.mocked(execute).mock.calls.map(([request]) => (request.action.command ?? request.action.query) as { evidence: string })
  expect(sent.map(item => item.evidence)).toEqual(['Assistant request: Failed before the IdP was contacted', `Assistant request: ${near}`.slice(0, 2000), ''])
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
  for (const action of [{ action: 'runtime' }, { action: 'list' }, { action: 'run' }]) expect(await shim.call(action)).toMatchObject({ code: 'login_required', error: expect.stringContaining('confirm the request in the OpenApe Pods app') })
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

it('hands the owner identity only to calls of its own session and discards it when the session ends', async () => {
  let now = 1_000_000
  const tokens = () => ({ active: true, close: vi.fn() })
  const issued: ReturnType<typeof tokens>[] = []
  const login = async () => { const owner = tokens(); issued.push(owner); return owner as never }
  const sessions = new McpOwnerSessions({ login, confirm: vi.fn(async () => true), now: () => now })
  const peer = { closed: false, send: vi.fn() }; const other = { closed: false, send: vi.fn() }
  await expect(sessions.authorize(peer, undefined)).rejects.toThrow('login_required')
  await vi.waitFor(() => expect(peer.send).toHaveBeenCalledOnce())
  const secret = (peer.send.mock.calls[0]![0] as { session: string }).session
  await sessions.authorize(peer, secret)
  expect(sessions.owner(peer)).toBe(issued[0])
  expect(sessions.owner(other)).toBeNull()
  // The hard end of the hour ends the session and discards the owner tokens.
  now += 3600000
  expect(sessions.owner(peer)).toBeNull()
  await expect(sessions.authorize(peer, secret)).rejects.toThrow('login_required')
  expect(issued[0]!.close).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(peer.send).toHaveBeenCalledTimes(2))
  sessions.disconnect(peer)
  expect(issued[1]!.close).toHaveBeenCalledOnce()
  // A declined confirmation discards the tokens of that sign-in at once.
  const declined = new McpOwnerSessions({ login, confirm: async () => false })
  await expect(declined.authorize(other, undefined)).rejects.toThrow('login_required')
  await vi.waitFor(() => expect(issued[2]?.close).toHaveBeenCalledOnce())
  expect(declined.owner(other)).toBeNull()
})

// Both sign-in paths share one session model: the apes CLI proof opens it silently, the browser sign-in with
// the native confirmation is the fallback, and the session action reports either to the polling tool user.
function paths(options: { apes?: () => Promise<unknown> } = {}) {
  let now = 1_000_000
  const issued: { active: boolean, close: ReturnType<typeof vi.fn> }[] = []
  const owner = () => { const value = { active: true, close: vi.fn(async () => { value.active = false }) }; issued.push(value); return value }
  let loggedIn = true
  const apes = vi.fn(async () => options.apes ? options.apes() : loggedIn ? owner() : null)
  const login = vi.fn(async () => owner())
  let answer: (value: boolean) => void = () => {}
  const confirm = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve }))
  const sessions = new McpOwnerSessions({ apes: apes as never, login: login as never, confirm, now: () => now, loginTimeout: 60000 })
  return { sessions, apes, login, confirm, issued, answer: (value: boolean) => answer(value), advance: (ms: number) => { now += ms }, logout: () => { loggedIn = false } }
}

it('opens a session from a valid apes login without any dialog and lets the call through', async () => {
  const fixture = paths(); const { endpoint, execute } = await start(undefined, fixture.sessions)
  const shim = client(endpoint)
  expect(await shim.call({ action: 'session' })).toMatchObject({ result: { state: 'signed_out', via: null, expiresAt: null } })
  expect(fixture.apes).not.toHaveBeenCalled()
  expect(await shim.call({ action: 'list' })).toMatchObject({ result: { echoed: expect.any(String) } })
  const secret = await shim.session()
  expect(await shim.call({ action: 'session' })).toMatchObject({ result: { state: 'signed_in', via: 'apes', expiresAt: 1_000_000 + 3600000 } })
  expect(await shim.call({ action: 'list' }, secret)).toMatchObject({ result: expect.anything() })
  expect(fixture.apes).toHaveBeenCalledOnce()
  expect(fixture.login).not.toHaveBeenCalled(); expect(fixture.confirm).not.toHaveBeenCalled()
  expect(execute).toHaveBeenCalledTimes(2)
  expect(await shim.call({ action: 'session', podId: 'x' })).toMatchObject({ error: expect.stringContaining('no other fields') })
  await shim.end()
})

it('gives a second connection its own session and never the first one\'s', async () => {
  const fixture = paths(); const { endpoint } = await start(undefined, fixture.sessions)
  const first = client(endpoint); const second = client(endpoint)
  await first.call({ action: 'list' }); const secret = await first.session()
  fixture.logout()
  // The first connection's secret does not open the second connection, and without an apes login it must sign in.
  expect(await second.call({ action: 'list' }, secret)).toMatchObject({ code: 'login_required', status: { state: 'pending', via: 'browser' } })
  expect(second.frames.some(frame => frame.id === undefined && 'session' in frame)).toBe(false)
  expect(await first.call({ action: 'list' }, secret)).toMatchObject({ result: expect.anything() })
  await first.end(); await second.end()
})

it('re-derives the session from a still valid apes login after the hour and asks the owner once apes is logged out', async () => {
  const fixture = paths(); const { endpoint } = await start(undefined, fixture.sessions)
  const shim = client(endpoint)
  await shim.call({ action: 'list' }); const secret = await shim.session()
  fixture.advance(3600000)
  expect(await shim.call({ action: 'session' })).toMatchObject({ result: { state: 'expired', via: 'apes' } })
  expect(fixture.issued[0]!.close).toHaveBeenCalledOnce()
  expect(await shim.call({ action: 'list' }, secret)).toMatchObject({ result: expect.anything() })
  const renewed = await shim.session()
  expect(renewed).not.toBe(secret)
  fixture.advance(3600000); fixture.logout()
  expect(await shim.call({ action: 'list' }, renewed)).toMatchObject({ code: 'login_required', status: { state: 'pending', via: 'browser' } })
  expect(fixture.apes).toHaveBeenCalledTimes(3)
  await shim.end()
})

it('falls back when the apes login is refused and never opens a session from it', async () => {
  const fixture = paths({ apes: async () => { throw new Error('Owner identity does not match the requested account') } })
  const { endpoint, execute } = await start(undefined, fixture.sessions)
  const shim = client(endpoint)
  expect(await shim.call({ action: 'list' })).toMatchObject({ code: 'login_required', error: expect.stringContaining('The apes login on this Mac was not accepted: Owner identity does not match') })
  expect(fixture.login).toHaveBeenCalledOnce()
  expect(execute).not.toHaveBeenCalled()
  await shim.end()
})

it('reports the browser sign-in as pending, signed_in, denied and expired to the polling tool user', async () => {
  const fixture = paths(); fixture.logout()
  const { endpoint, execute } = await start(undefined, fixture.sessions)
  const shim = client(endpoint)
  const refused = await shim.call({ action: 'list' })
  expect(refused).toMatchObject({ code: 'login_required', status: { state: 'pending', via: 'browser', expiresAt: 1_000_000 + 60000 } })
  expect(refused.error).toContain('{"action":"session"} about every 5 seconds until its state is signed_in')
  expect(await shim.call({ action: 'session' })).toMatchObject({ result: { state: 'pending', via: 'browser' } })
  await vi.waitFor(() => expect(fixture.confirm).toHaveBeenCalledOnce())
  fixture.answer(true)
  const secret = await shim.session()
  expect(await shim.call({ action: 'session' })).toMatchObject({ result: { state: 'signed_in', via: 'browser', expiresAt: 1_000_000 + 3600000 } })
  expect(await shim.call({ action: 'list' }, secret)).toMatchObject({ result: expect.anything() })
  // A declined confirmation is denied and leaves no session; the next call asks again.
  await fixture.sessions.end()
  expect(await shim.call({ action: 'list' })).toMatchObject({ code: 'login_required', status: { state: 'pending' } })
  await vi.waitFor(() => expect(fixture.confirm).toHaveBeenCalledTimes(2))
  fixture.answer(false)
  await vi.waitFor(async () => expect(await shim.call({ action: 'session' })).toMatchObject({ result: { state: 'denied', via: 'browser', message: expect.stringContaining('declined') } }))
  // The hour of a session ends as expired.
  expect(await shim.call({ action: 'list' })).toMatchObject({ code: 'login_required' })
  await vi.waitFor(() => expect(fixture.confirm).toHaveBeenCalledTimes(3))
  fixture.answer(true); const next = await shim.session()
  fixture.advance(3600000)
  expect(await shim.call({ action: 'session' })).toMatchObject({ result: { state: 'expired', via: 'browser' } })
  expect(await shim.call({ action: 'list' }, next)).toMatchObject({ code: 'login_required' })
  expect(execute).toHaveBeenCalledOnce()
  await shim.end()
})
