// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { RunStore } from '../../src/worker/runs/store'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { installExample } from '../../src/worker/runs/examples'
import { EffectLedger } from '../../src/worker/recovery/effects'
import { executeHttpEffect } from '../../src/worker/runs/http'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-http-effects-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'HTTPS fixture' })
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const run = new RunStore(store).reserve(pod.id, store.getPod(pod.id).activeScript!, 0).run
  return { store, pod, run, ledger: new EffectLedger(store) }
}
const request = { url: 'https://example.com/notify', method: 'POST', headers: {}, body: 'synthetic-secret', key: 'new-mail:1' }
it('persists intent before delivery, reuses receipts and stores no request secret', async () => {
  const f = fixture(); let deliveries = 0
  const send = async () => { expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()?.state).toBe('intent'); deliveries++; return { status: 200, headers: {}, body: '{}' } }
  const first = await executeHttpEffect(f.ledger, f.pod.id, f.run.id, request, send)
  expect(await executeHttpEffect(f.ledger, f.pod.id, f.run.id, request, send)).toEqual(first)
  expect(deliveries).toBe(1)
  expect(JSON.stringify(f.store.db.prepare('SELECT * FROM effect_ledger').all())).not.toContain('synthetic-secret')
  await expect(executeHttpEffect(f.ledger, f.pod.id, f.run.id, { ...request, body: 'changed' }, send)).rejects.toThrow('conflicting')
})
it('marks failed delivery unknown and prevents an automatic second request', async () => {
  const f = fixture(); let deliveries = 0
  const send = async () => { deliveries++; throw new Error('connection lost') }
  await expect(executeHttpEffect(f.ledger, f.pod.id, f.run.id, request, send)).rejects.toThrow('connection lost')
  expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()?.state).toBe('unknown')
  await expect(executeHttpEffect(f.ledger, f.pod.id, f.run.id, request, send)).rejects.toThrow('unknown')
  expect(deliveries).toBe(1)
})

it('requires owner review of a mutating HTTP error response instead of retaining an unusable retry receipt', async () => {
  const f = fixture()
  await expect(executeHttpEffect(f.ledger, f.pod.id, f.run.id, request, async () => ({ status: 403, headers: {}, body: '{}' }))).rejects.toThrow('review delivery')
  expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()?.state).toBe('unknown')
})

it('stores only a digest receipt when requested and replays it without a second delivery', async () => {
  const f = fixture(); let deliveries = 0
  const reply = { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: { id: 'synthetic', history: 'x'.repeat(40000) } }) }
  const send = async () => { deliveries++; return reply }
  const digest = { ...request, key: 'claim:1', receipt: 'digest' as const }
  expect(await executeHttpEffect(f.ledger, f.pod.id, f.run.id, digest, send)).toEqual(reply)
  const replay = await executeHttpEffect(f.ledger, f.pod.id, f.run.id, digest, send)
  expect(replay).toEqual({ status: 200, headers: {}, body: '', receipt: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: Buffer.byteLength(reply.body) } })
  expect(deliveries).toBe(1)
  expect(JSON.stringify(f.store.db.prepare('SELECT * FROM effect_ledger').all())).not.toContain('synthetic')
})
