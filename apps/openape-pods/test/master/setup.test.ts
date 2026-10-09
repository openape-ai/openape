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
it('refuses access proposals and setup answers: access is configured directly or requested through OpenApe Secrets', () => {
  const podId = randomUUID()
  for (const request of [
    { provider: 'http', origin: 'https://api.telegram.org', methods: ['POST'], description: 'Notify after filing' },
    { provider: 'credential', alias: 'telegram_bot_token', description: 'Bot token' },
    { provider: 'variable', alias: 'telegram_chat_id', description: 'Which chat receives notifications?' },
  ]) expect(() => parseMasterAction({ action: 'requestAccess', podId, revision: 1, request })).toThrow('not allowed')
  for (const type of ['answerSetup', 'resolveSetup', 'decline']) expect(() => parseMasterCommand({ type, id: randomUUID(), podId })).toThrow('Unsupported master request')
  expect(() => parseResourceCommand({ type: 'assignDirectory', podId, epoch: 0, path: '/Invoices', access: 'readWrite' })).toThrow()
  expect(parseResourceCommand({ type: 'reviewDirectory', podId, epoch: 0, path: '/Invoices', access: 'readWrite' }).type).toBe('reviewDirectory')
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
