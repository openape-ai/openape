// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthorityError } from '../../src/contracts/infrastructure'
import type { HttpRequest } from '../../src/contracts/http'
import type { AgentConnection } from '../../src/main/broker/authorization'
import { executeHttp } from '../../src/main/programs/http-service'
import { programRequest } from '../../src/main/programs/invoke'
import { prepareProgramAuthorization } from '../../src/main/programs/session'
import { authorizeCredentialService } from '../../src/worker/mail/authorization'
import type { RunServiceScope } from '../../src/worker/runs/dispatcher'
import { closeNetworks, networkFixture } from './network-fixture'

// Only the IdP decision, the outgoing HTTP request and native executable checks are stubbed; the
// dispatcher, the worker's resource lookups and the desktop's grant and HTTP services are real.
const idp = vi.hoisted(() => ({ authorize: vi.fn(), send: vi.fn() }))
vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
vi.mock('../../src/main/broker/authorization', async original => ({ ...await original<object>(), AgentAuthority: class { authorize = idp.authorize; assertActive = vi.fn() } }))
vi.mock('../../src/main/connections/agent', async original => ({ ...await original<object>(), PodIdentityManager: class { connection() { return {} } } }))
vi.mock('../../src/main/programs/http', () => ({ requestHttp: idp.send }))
vi.mock('../../src/main/programs/runtime', async original => ({ ...await original<object>(), verifyProgramRuntime: async () => {} }))
vi.mock('../../src/worker/runtime/sandbox', async original => ({ ...await original<object>(), verifyExecutable: async () => {} }))
vi.mock('@openape/apes', async original => ({
  ...await original<object>(),
  loadAdapter: () => ({ digest: 'digest' }),
  resolveCommand: async (_adapter: unknown, argv: string[]) => argv[0] === 'pod-http' ? { permission: 'http', detail: { action: 'request' } } : { permission: `calendar:${argv[1]}`, detail: { action: argv[1] } },
}))
afterEach(async () => { await closeNetworks(); vi.resetAllMocks() })

const secret = 'synthetic-bot-secret'
const origin = 'https://chat.example.com'

function chain() {
  const launched: { podId: string, argv: string[] }[] = []
  const secrets = new Map<string, string>()
  const serviceScope = ({ podId, runId, epoch, assignmentRevision, capabilities }: RunServiceScope) => ({ podId, runId, epoch, assignmentRevision, capabilities })
  const f: ReturnType<typeof networkFixture> = networkFixture({
    // Worker tool service resolves the Pod's sandboxed application; the desktop then requires a covering grant before launch.
    tool: async (body, signal, scope) => {
      const { assignment, argv } = programRequest(f.resources.list(scope.podId), scope.podId, scope.capabilities, body)
      const { authority, authorization } = await prepareProgramAuthorization(assignment, {} as AgentConnection, argv)
      await authority.authorize(authorization, signal)
      launched.push({ podId: scope.podId, argv })
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ events: ['Standup 09:00'] }) }
    },
    http: async (request: HttpRequest, signal, scope) => executeHttp(f.resources.list(scope.podId), serviceScope(scope), request, '/unused', {} as AgentConnection, signal),
    credential: async (alias, _signal, scope) => secrets.get(authorizeCredentialService(f.store, f.resources, f.dispatcher.runs, { scope: serviceScope(scope) }, alias))!,
  })
  const items: string[] = []
  const source = f.pod('Mail check', { takes: [], gives: ['mail'], summary: 'Finds relevant mail' }, async (_items, invoke) => {
    await invoke('network.emit', { channel: 'mail', key: 'm1', sourceItemId: 'm1', sourceVersion: 'v1', payload: { subject: 'Quarterly review' } })
  })
  const calendar = f.pod('Calendar and issues', { takes: ['mail'], gives: ['brief'], summary: 'Adds the day' }, async (received, invoke) => {
    for (const item of received) {
      const reply = await invoke('tools.invoke', { application: 'calendar', argv: ['list', '--day', 'today'] }) as { stdout: string }
      await invoke('graph.emit', { channel: 'brief', key: item.key, data: { subject: `${String(item.data.subject)}; ${(JSON.parse(reply.stdout) as { events: string[] }).events.join(', ')}` } })
    }
  })
  const bot = f.pod('Calendar bot', { takes: ['brief'], gives: [], summary: 'Posts the briefing' }, async (received, invoke) => {
    const token = await invoke('credentials.get', { alias: 'bot_token' }) as string
    for (const item of received) {
      await invoke('http.request', { url: `${origin}/messages`, method: 'POST', headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: item.data.subject }), key: `briefing:${item.key}` })
      items.push(item.key)
    }
  })
  const assignCalendar = (podId: string) => {
    const id = randomUUID()
    const capability = `tool.app_${id.replaceAll('-', '')}.invoke`
    f.resources.assignProgram(podId, id, { type: 'program', name: 'calendar', capability, stateId: randomUUID(), executable: '/synthetic/o365-cli', executableHash: 'a'.repeat(64), cliId: 'o365-cli', adapterPath: '/synthetic/o365.toml', adapterHash: 'b'.repeat(64), networkHosts: [], entryFiles: [], environment: {} }, f.resources.epoch(podId))
    return capability
  }
  const assignBot = (podId: string) => {
    f.resources.assignHttp(podId, { origin, methods: ['POST'] }, f.resources.epoch(podId))
    const credentialId = randomUUID()
    f.resources.assignCredential(podId, 'bot_token', credentialId, f.resources.epoch(podId))
    secrets.set(credentialId, secret)
    const http = f.resources.list(podId).find(resource => resource.configuration.type === 'http')!.configuration.capability as string
    return [http, 'credential.bot_token']
  }
  /** Declares exactly these capabilities in the pinned script, validates it for the current resources and resumes the Pod. */
  const declare = (podId: string, capabilities: string[]) => {
    const pod = f.store.getPod(podId)
    const row = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript!)!
    f.store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify({ ...JSON.parse(row.manifest as string), capabilities }), podId, pod.activeScript!)
    f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(podId, pod.activeScript!, pod.bindingRevision, f.resources.epoch(podId), '{}')
    f.store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(podId)
  }
  const create = () => f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: calendar, source: null, serialCase: false }, { podId: bot, source: null, serialCase: false }], ['mail', 'brief'])
  /** Activates the network, runs the source once and dispatches consumers until every member settled. */
  const run = async (id: string) => {
    f.engine.execute({ type: 'activate', id, revision: 1 })
    f.process(id, [source])
    await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
    for (const podId of [calendar, bot]) {
      f.engine.tick()
      await vi.waitFor(() => expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=?').get(podId)?.state).toBeDefined())
      await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
    }
  }
  const state = (podId: string) => f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(podId)?.state
  return { f, source, calendar, bot, items, launched, assignCalendar, assignBot, declare, create, run, state }
}

it('processes one item through a source, a program-reading consumer and a consumer posting with its secret', async () => {
  idp.authorize.mockResolvedValue(undefined)
  idp.send.mockResolvedValue({ status: 201, headers: {}, body: '{"id":"message-1"}' })
  const c = chain()
  c.declare(c.calendar, [c.assignCalendar(c.calendar)])
  c.declare(c.bot, c.assignBot(c.bot))
  const id = c.create()
  await c.run(id)
  expect([c.state(c.source), c.state(c.calendar), c.state(c.bot)]).toEqual(['completed', 'completed', 'completed'])
  expect(c.launched).toEqual([{ podId: c.calendar, argv: ['list', '--day', 'today'] }])
  expect(c.items).toEqual(['m1'])
  expect(idp.authorize).toHaveBeenCalledTimes(2)
  expect(idp.send).toHaveBeenCalledTimes(1)
  const sent = idp.send.mock.calls[0]![0] as HttpRequest
  expect(sent).toMatchObject({ url: `${origin}/messages`, method: 'POST', headers: { authorization: `Bearer ${secret}` } })
  expect(JSON.parse(sent.body!)).toEqual({ text: 'Quarterly review; Standup 09:00' })
  expect(c.f.store.db.prepare('SELECT state FROM effect_ledger WHERE pod_id=?').all(c.bot)).toEqual([{ state: 'completed' }])
  expect(c.f.store.db.prepare('SELECT state FROM network_deliveries ORDER BY accepted_at').all()).toEqual([{ state: 'done' }, { state: 'done' }])
  const retained = JSON.stringify([c.f.store.db.prepare('SELECT body FROM network_trace_events').all(), c.f.store.db.prepare('SELECT * FROM effect_ledger').all()])
  expect(retained).not.toContain(secret)
})

it('refuses a program command and an HTTP request without their IdP grant and sends nothing', async () => {
  idp.authorize.mockRejectedValue(new AuthorityError('Grant does not cover required permission: http'))
  const c = chain()
  const refusals: string[] = []
  c.f.behaviours.set(c.calendar, async (received, invoke) => {
    await invoke('tools.invoke', { application: 'calendar', argv: ['list', '--day', 'today'] }).catch((error: Error) => refusals.push(error.message))
    for (const item of received) await invoke('graph.emit', { channel: 'brief', key: item.key, data: { subject: String(item.data.subject) } })
  })
  c.f.behaviours.set(c.bot, async (received, invoke) => {
    for (const item of received) await invoke('http.request', { url: `${origin}/messages`, method: 'POST', headers: {}, body: '{}', key: `briefing:${item.key}` }).catch((error: Error) => refusals.push(error.message))
  })
  c.declare(c.calendar, [c.assignCalendar(c.calendar)])
  c.declare(c.bot, c.assignBot(c.bot))
  await c.run(c.create())
  expect(refusals).toEqual([expect.stringContaining('Grant does not cover'), expect.stringContaining('Grant does not cover')])
  expect(c.launched).toEqual([])
  expect(idp.send).not.toHaveBeenCalled()
  // An effect whose request was refused is held for owner review like in a standalone Pod; nothing is retried.
  expect(c.f.store.db.prepare('SELECT state FROM effect_ledger WHERE pod_id=?').all(c.bot)).toEqual([{ state: 'unknown' }])
  expect(c.state(c.bot)).not.toBe('completed')
})

it('refuses programs, HTTP destinations and secrets assigned to another member', async () => {
  const c = chain()
  const refusals: string[] = []
  const foreign = async (invoke: (operation: string, payload: unknown) => Promise<unknown>) => {
    for (const [operation, payload] of [['tools.invoke', { application: 'calendar', argv: ['list', '--day', 'today'] }], ['http.request', { url: `${origin}/messages`, method: 'POST', headers: {}, body: '{}', key: 'foreign' }], ['credentials.get', { alias: 'bot_token' }]] as const) {
      await invoke(operation, payload).then(() => refusals.push(`${operation} succeeded`), (error: Error) => refusals.push(error.message))
    }
  }
  c.f.behaviours.set(c.source, async (_items, invoke) => {
    await foreign(invoke)
    await invoke('network.emit', { channel: 'mail', key: 'm1', sourceItemId: 'm1', sourceVersion: 'v1', payload: { subject: 'Quarterly review' } })
  })
  c.f.behaviours.set(c.calendar, async (received, invoke) => {
    for (const item of received) await invoke('graph.emit', { channel: 'brief', key: item.key, data: { subject: String(item.data.subject) } })
  })
  c.f.behaviours.set(c.bot, async (_received, invoke) => { await invoke('tools.invoke', { application: 'calendar', argv: ['list', '--day', 'today'] }).catch((error: Error) => refusals.push(error.message)) })
  // The calendar belongs to the first consumer, the destination and secret to the bot; the source declares neither.
  c.declare(c.calendar, [c.assignCalendar(c.calendar)])
  c.declare(c.bot, c.assignBot(c.bot))
  await c.run(c.create())
  expect(refusals).toEqual([
    expect.stringContaining('No tool capability is assigned'),
    expect.stringContaining('HTTP destination is not assigned'),
    expect.stringContaining('Credential is missing'),
    expect.stringContaining('No tool capability is assigned'),
  ])
  expect(c.launched).toEqual([])
  expect(idp.authorize).not.toHaveBeenCalled()
  expect(idp.send).not.toHaveBeenCalled()
})
