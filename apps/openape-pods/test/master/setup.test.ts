// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { parseMasterAction, parseMasterCommand } from '../../src/contracts/master'
import { parseResourceCommand } from '../../src/contracts/resources'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { MasterSetup } from '../../src/worker/master/setup'
import { MasterDeadline } from '../../src/worker/master/deadline'
import { modelResources } from '../../src/worker/master/resources'
import type { SetupRequest } from '../../src/contracts/setup'

const stores: PodDatabase[] = []
afterEach(() => { vi.useRealTimers(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-chat-setup-'))); stores.push(store)
  const pod = store.createPod({ name: 'Invoice filing' }); const resources = new ResourceRegistry(store, () => {})
  const setup = new MasterSetup(store, resources)
  const propose = (request: SetupRequest) => { const id = randomUUID(); store.db.prepare('INSERT INTO access_proposals VALUES(?,?,?,?)').run(id, pod.id, JSON.stringify(request), 'pending'); return id }
  return { store, pod, resources, setup, propose }
}
it('accepts concrete owner proposals without granting model access or accepting secret values', () => {
  const podId = randomUUID()
  for (const request of [
    { provider: 'http', origin: 'https://api.telegram.org', methods: ['POST'], description: 'Notify after filing' },
    { provider: 'directory', path: '/Invoices', access: 'readWrite', description: 'Save invoice files' },
    { provider: 'application', application: 'o365-cli', argv: ['mail', 'list'], networkHosts: ['graph.microsoft.com'], description: 'Read new mail' },
    { provider: 'credential', alias: 'telegram_bot_token', description: 'Bot token', instructions: 'Obtain it from BotFather; use Variables and secrets.' },
    { provider: 'variable', alias: 'telegram_chat_id', description: 'Which chat receives notifications?' },
  ]) expect(parseMasterAction({ action: 'requestAccess', podId, revision: 1, request })).toMatchObject({ request })
  expect(() => parseMasterAction({ action: 'resolveSetup', podId, revision: 1 })).toThrow()
  expect(() => parseMasterAction({ action: 'requestAccess', podId, revision: 1, request: { provider: 'credential', alias: 'token', description: 'Token', value: 'never-send-this' } })).toThrow()
  expect(() => parseMasterAction({ action: 'requestAccess', podId, revision: 1, request: { provider: 'http', origin: 'https://api.telegram.org/path', methods: ['POST'], description: 'Wrong scope' } })).toThrow()
  expect(() => parseResourceCommand({ type: 'assignDirectory', podId, epoch: 0, path: '/Invoices', access: 'readWrite' })).toThrow()
  expect(parseResourceCommand({ type: 'reviewDirectory', podId, epoch: 0, path: '/Invoices', access: 'readWrite' }).type).toBe('reviewDirectory')
})
it('requires actual current resources before resolving an HTTP proposal and rejects foreign resources', async () => {
  const { store, pod, resources, setup, propose } = fixture()
  const request: SetupRequest = { provider: 'http', origin: 'https://api.telegram.org', methods: ['POST'], description: 'Notify' }
  const id = propose(request); const resourceId = randomUUID()
  const command = { type: 'resolveSetup' as const, id, podId: pod.id, resourceId, epoch: 0, request }
  await expect(setup.resolve(command)).rejects.toThrow('Resources changed')
  const other = store.createPod({ name: 'Other' })
  store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(resourceId, other.id, 'tool', 'ready', 'Telegram', JSON.stringify({ type: 'http', origin: request.origin, methods: ['POST'] }))
  await expect(setup.resolve(command)).rejects.toThrow('Resources changed')
  store.db.prepare('UPDATE resources SET pod_id=?,configuration=? WHERE id=?').run(pod.id, JSON.stringify({ type: 'http', origin: request.origin, methods: ['GET'] }), resourceId)
  await expect(setup.resolve(command)).rejects.toThrow('not configured')
  store.db.prepare('UPDATE resources SET configuration=? WHERE id=?').run(JSON.stringify({ type: 'http', origin: request.origin, methods: ['POST'] }), resourceId)
  await expect(setup.resolve({ ...command, epoch: 1 })).rejects.toThrow('Resources changed')
  await setup.resolve(command)
  expect(setup.proposals(pod.id)[0]?.state).toBe('approved')
  expect(store.getPod(pod.id).lifecycle).toBe('paused'); expect(resources.epoch(pod.id)).toBe(0)
})
it('saves ordinary follow-up answers atomically and cannot use that route for credentials', () => {
  const { pod, setup, propose, store } = fixture()
  const id = propose({ provider: 'variable', alias: 'telegram_chat_id', description: 'Which chat?' })
  const command = { type: 'answerSetup' as const, id, podId: pod.id, value: '123456', revision: 0 }
  expect(parseMasterCommand(command)).toEqual(command)
  expect(() => setup.answer({ ...command, revision: 1 })).toThrow('Variable changed')
  expect(setup.proposals(pod.id)[0]?.state).toBe('pending')
  setup.answer(command)
  expect(store.db.prepare('SELECT name,value FROM pod_variables WHERE pod_id=?').all(pod.id)).toEqual([{ name: 'telegram_chat_id', value: '123456' }])
  const credential = propose({ provider: 'credential', alias: 'bot_token', description: 'Secret' })
  expect(() => setup.answer({ ...command, id: credential, value: 'a-secret' })).toThrow('Variables and secrets')
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM pod_variables').get()?.count).toBe(1)
})
it('reports secret presence from encrypted resource metadata and reopens the need after revocation', () => {
  const { pod, setup, propose, resources, store } = fixture()
  propose({ provider: 'credential', alias: 'bot_token', description: 'Token', instructions: 'Use the protected form' })
  resources.assignCredential(pod.id, 'bot_token', randomUUID(), 0)
  expect(setup.proposals(pod.id)[0]?.state).toBe('approved')
  const resource = resources.list(pod.id)[0]!
  store.db.prepare('UPDATE resources SET state=\'revoked\' WHERE id=?').run(resource.id)
  expect(setup.proposals(pod.id)[0]?.state).toBe('pending')
  expect(modelResources([resource])[0]?.configuration).toEqual({ alias: 'bot_token' })
})
it('keeps working setup alive beyond two minutes, but bounds stalls and total duration', () => {
  vi.useFakeTimers()
  const expire = vi.fn(); const deadline = new MasterDeadline(expire)
  for (let minute = 0; minute < 9; minute++) { vi.advanceTimersByTime(60000); deadline.progress() }
  expect(expire).not.toHaveBeenCalled()
  vi.advanceTimersByTime(60000)
  expect(expire.mock.calls[0]?.[0].message).toContain('time limit'); deadline.close()
  expire.mockClear(); const stalled = new MasterDeadline(expire); vi.advanceTimersByTime(120000)
  expect(expire.mock.calls[0]?.[0].message).toContain('stopped responding'); stalled.close()
  expire.mockClear(); vi.advanceTimersByTime(600000); expect(expire).not.toHaveBeenCalled()
})
it('reports missing script honestly without creating a starter draft', () => {
  const { setup, pod, store } = fixture()
  expect(setup.scriptState(pod.id)).toBe('missing')
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM script_drafts').get()?.count).toBe(0)
})
