// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { assignedJev, defaultJevModel, parseJevModel, parseJevRequest, parseJevResult, syntheticJevResult } from '../../src/contracts/jev'
import { evaluateTypesafe, typesafeJSON, verifyTypesafe } from '../../src/main/connections/typesafe'
import { executeJev } from '../../src/main/connections/jev-service'
import { AgentAuthority } from '../../src/main/broker/authorization'
import { CredentialCache } from '../../src/main/connections/cache'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { SetupControl } from '../../src/worker/onboarding/control'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const request = parseJevRequest({ state: 'Synthetic invoice question', questions: {
  department: { type: 'choice', instructions: 'Route', criteria: { billing: 'Invoices', review: 'Unclear' } },
  urgency: { type: 'score', instructions: 'Urgency', criteria: ['Low', 'High'] },
  relevant: { type: 'noul', instructions: 'Related to support?' },
} })
const result = () => syntheticJevResult(request, defaultJevModel)
const signal = () => new AbortController().signal

it('validates all three question types, pinned models and exact response contracts', () => {
  expect(parseJevResult(result(), request, defaultJevModel)).toEqual(result())
  for (const invalid of [{ ...request, url: 'https://other.invalid' }, { ...request, state: 'x'.repeat(128 * 1024) }, { state: 42, questions: request.questions }, { ...request, questions: { bad: { type: 'score', instructions: 'x', criteria: ['one'] } } }]) expect(() => parseJevRequest(invalid)).toThrow()
  expect(() => parseJevModel('jev-stable')).toThrow('pinned')
  const bad = result(); bad.answers.department = { type: 'choice', choice: 'unknown', confidence: 1, probabilities: { billing: 1, review: 0 } }
  expect(() => parseJevResult(bad, request, defaultJevModel)).toThrow('unknown choice')
  for (const invalid of [{ ...result(), model: 'jev-9.0.0' }, { ...result(), answers: {} }, { ...result(), usage: { input_tokens: -1, output_tokens: 0 } }]) expect(() => parseJevResult(invalid, request, defaultJevModel)).toThrow()
  const invalid = result(); invalid.answers.relevant = { type: 'noul', noul: Infinity }
  expect(() => parseJevResult(invalid, request, defaultJevModel)).toThrow('probability')
  expect(JSON.stringify(parseJevResult({ ...result(), authorization: 'never-return-this' }, request, defaultJevModel))).not.toContain('never-return-this')
})

it('verifies with authenticated model discovery without submitting an evaluation', async () => {
  const transport = vi.fn(async () => Response.json({ models: [{ name: 'jev-stable' }] }))
  vi.stubGlobal('fetch', transport)
  await verifyTypesafe('synthetic-key', signal())
  expect(transport).toHaveBeenCalledExactlyOnceWith('https://api.typesafe.ai/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer synthetic-key' }, redirect: 'error', signal: expect.any(AbortSignal) }))
  transport.mockImplementationOnce(async () => new Response('secret echoed in error', { status: 401 }))
  await expect(verifyTypesafe('synthetic-key', signal())).rejects.toThrow('API key is invalid')
})

it('counts retries, refuses auth errors and enforces the shared per-run attempt budget', async () => {
  const consume = vi.fn(); const send = vi.fn(async (_body: string, _signal: AbortSignal) => Response.json(result()))
  send.mockImplementationOnce(async () => new Response('private error', { status: 429, headers: { 'retry-after': '0' } }))
  expect(await evaluateTypesafe(request, defaultJevModel, signal(), send, consume)).toEqual({ result: result(), attempts: 2 })
  expect(consume).toHaveBeenCalledTimes(2)
  expect(JSON.parse(send.mock.calls[0]![0])).toEqual({ ...request, model: defaultJevModel })
  const auth = vi.fn(async () => new Response('private error', { status: 403 }))
  await expect(evaluateTypesafe(request, defaultJevModel, signal(), auth, consume)).rejects.toThrow('API key is invalid')
  expect(auth).toHaveBeenCalledTimes(1)
  const limited = vi.fn(async () => new Response('', { status: 529, headers: { 'retry-after': '0' } }))
  let count = 0
  await expect(evaluateTypesafe(request, defaultJevModel, signal(), limited, () => { if (++count > 2) throw new Error('budget exhausted') })).rejects.toThrow('budget exhausted')
  expect(limited).toHaveBeenCalledTimes(2)
})

it('cancels provider backoff immediately and rejects oversized or malformed bodies', async () => {
  const controller = new AbortController()
  const send = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '999999999999' } }))
  const pending = evaluateTypesafe(request, defaultJevModel, controller.signal, send, () => {})
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1)); controller.abort(); await rejected
  await expect(typesafeJSON(new Response('x'.repeat(128 * 1024 + 1)))).rejects.toThrow('exceeds')
  await expect(typesafeJSON(new Response('private non-json body'))).rejects.toThrow('invalid JSON')
  const stopped = vi.fn(); await expect(evaluateTypesafe(request, defaultJevModel, controller.signal, stopped, () => {})).rejects.toThrow(); expect(stopped).not.toHaveBeenCalled()
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-jev-')); const store = new PodDatabase(root)
  cleanups.push(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const cancelled = vi.fn(); const registry = new ResourceRegistry(store, cancelled); const setup = new SetupControl(store, registry)
  const pod = store.createPod({ name: 'Support router' }); const connectionId = randomUUID()
  setup.execute({ type: 'save', connection: { id: connectionId, provider: 'typesafe', account: 'TypeSafe / Jev', state: 'ready', error: null }, metadata: { verifiedAt: 1 } })
  const authority = { ownerConnection: randomUUID(), grantId: 'grant-fixture', identity: { connectionId: randomUUID(), podId: pod.id, issuer: 'https://id.example.invalid', owner: 'owner@example.invalid', subject: 'agent@example.invalid', keyId: 'fixture' } }
  registry.assignJev(pod.id, connectionId, defaultJevModel, 20, authority, registry.epoch(pod.id))
  return { root, store, registry, setup, pod, cancelled, connectionId, assignment: assignedJev(registry.list(pod.id), pod.id, ['jev.evaluate']) }
}
it('requires explicit assignment and capability, rejects cross-Pod access, and keeps reconnection revoked', () => {
  const f = fixture()
  expect(() => assignedJev(f.registry.list(f.pod.id), randomUUID(), ['jev.evaluate'])).toThrow('not assigned')
  expect(() => assignedJev(f.registry.list(f.pod.id), f.pod.id, [])).toThrow('not assigned')
  f.setup.execute({ type: 'revoke', id: f.connectionId })
  expect(f.cancelled).toHaveBeenCalledWith(f.pod.id)
  expect(() => assignedJev(f.registry.list(f.pod.id), f.pod.id, ['jev.evaluate'])).toThrow('not assigned')
  f.setup.execute({ type: 'save', connection: { id: f.connectionId, provider: 'typesafe', account: 'TypeSafe / Jev', state: 'ready', error: null }, metadata: { verifiedAt: 2 } })
  expect(() => assignedJev(f.registry.list(f.pod.id), f.pod.id, ['jev.evaluate'])).toThrow('not assigned')
})

it('cancels an in-flight evaluation when its grant is revoked', async () => {
  const f = fixture()
  vi.spyOn(AgentAuthority.prototype, 'authorize').mockResolvedValue({} as never)
  let active = true
  vi.spyOn(AgentAuthority.prototype, 'assertActive').mockImplementation(async () => { if (!active) throw new Error('revoked') })
  const send = vi.fn(async (_body: string, attempt: AbortSignal): Promise<Response> => new Promise((_resolve, reject) => attempt.addEventListener('abort', () => reject(attempt.reason), { once: true })))
  const credentials = new CredentialCache(join(f.root, 'credentials'), { available: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  const pending = executeJev(f.assignment, request, { vendor: resolve('runtime-sources'), credentials, signal: signal(), observe: async () => {}, previous: async () => undefined, check: async () => {}, send, consumeAttempt: () => {} })
  const rejected = expect(pending).rejects.toThrow('no longer active')
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1)); active = false
  await rejected
})
