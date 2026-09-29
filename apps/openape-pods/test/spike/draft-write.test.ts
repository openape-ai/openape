// @vitest-environment node
// Throwaway spike for issue 1407 (plan M0, Spike A). Removed in the final commit.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { parseHttpRequest } from '../../src/contracts/http'
import { EffectLedger } from '../../src/worker/recovery/effects'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { installExample } from '../../src/worker/runs/examples'
import { executeHttpEffect } from '../../src/worker/runs/http'
import { RunStore } from '../../src/worker/runs/store'
import { PodDatabase } from '../../src/worker/storage/database'

const cleanup: (() => void)[] = []
afterEach(() => { for (const task of cleanup.splice(0)) task() })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-draft-spike-'))
  const store = new PodDatabase(root)
  cleanup.push(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const pod = store.createPod({ name: 'Reply drafts' })
  installExample(store, new ResourceRegistry(store, () => {}), pod.id, 'deterministic', 'a'.repeat(64))
  const run = new RunStore(store).reserve(pod.id, store.getPod(pod.id).activeScript!, 0).run
  return { store, pod, run, ledger: new EffectLedger(store) }
}
const ledgerText = (store: PodDatabase) => JSON.stringify(store.db.prepare('SELECT * FROM effect_ledger').all())

// Path 1: the script calls the mail provider itself and carries the bearer token.
it('path 1: an effect-keyed provider request works today, with the token inside the script', async () => {
  const f = fixture(); let deliveries = 0
  const request = parseHttpRequest({
    url: 'https://graph.microsoft.com/v1.0/me/messages/AAMk-1/createReply',
    method: 'POST',
    headers: { 'authorization': 'Bearer synthetic-token', 'content-type': 'application/json' },
    body: JSON.stringify({ comment: 'Synthetic reply text' }),
    key: 'draft:AAMk-1:v1',
    receipt: 'digest',
  })
  const reply = { status: 201, headers: {}, body: JSON.stringify({ id: 'draft-1', body: { content: 'Synthetic reply text' } }) }
  const send = async () => { deliveries++; return reply }
  expect(await executeHttpEffect(f.ledger, f.pod.id, f.run.id, request, send)).toEqual(reply)
  const replay = await executeHttpEffect(f.ledger, f.pod.id, f.run.id, request, send)
  expect(deliveries).toBe(1)
  // The digest receipt drops the draft id, so a replay cannot tell the script which draft exists.
  expect(replay.body).toBe('')
  expect(ledgerText(f.store)).not.toContain('synthetic-token')
  expect(ledgerText(f.store)).not.toContain('Synthetic reply text')
  // The script had to hold the token to build this request.
  expect(request.headers.authorization).toBe('Bearer synthetic-token')
})

// Path 2: a granted write command runs in the application sandbox; the ledger wraps the call.
async function draftEffect(ledger: EffectLedger, podId: string, runId: string, key: string, input: { messageId: string, version: string, textHash: string }, invoke: () => Promise<{ draftId: string }>) {
  const intent = ledger.begin(podId, runId, key, 'mail.draft', input)
  if (!intent.execute) return intent.result as { draftId: string }
  try {
    const receipt = await invoke()
    ledger.complete(podId, key, receipt)
    return receipt
  }
  catch (error) { ledger.markUnknown(podId, key); throw error }
}
const input = { messageId: 'AAMk-1', version: 'CQAAABYAAAB', textHash: 'b'.repeat(64) }

it('path 2: a ledger-wrapped command creates one draft and replays its receipt', async () => {
  const f = fixture(); let invocations = 0
  const invoke = async () => { invocations++; return { draftId: 'draft-1' } }
  expect(await draftEffect(f.ledger, f.pod.id, f.run.id, 'draft:AAMk-1:v1', input, invoke)).toEqual({ draftId: 'draft-1' })
  expect(await draftEffect(f.ledger, f.pod.id, f.run.id, 'draft:AAMk-1:v1', input, invoke)).toEqual({ draftId: 'draft-1' })
  expect(invocations).toBe(1)
  expect(f.store.db.prepare('SELECT operation,state FROM effect_ledger').get()).toEqual({ operation: 'mail.draft', state: 'completed' })
})

it('path 2: an interrupted command creates no second draft', async () => {
  const f = fixture(); let invocations = 0
  const invoke = async () => { invocations++; throw new Error('command stopped') }
  await expect(draftEffect(f.ledger, f.pod.id, f.run.id, 'draft:AAMk-1:v1', input, invoke)).rejects.toThrow('command stopped')
  await expect(draftEffect(f.ledger, f.pod.id, f.run.id, 'draft:AAMk-1:v1', input, invoke)).rejects.toThrow('reconcile before retrying')
  expect(invocations).toBe(1)
})

it('path 2: a changed reply text under the same key is refused', async () => {
  const f = fixture()
  await draftEffect(f.ledger, f.pod.id, f.run.id, 'draft:AAMk-1:v1', input, async () => ({ draftId: 'draft-1' }))
  await expect(draftEffect(f.ledger, f.pod.id, f.run.id, 'draft:AAMk-1:v1', { ...input, textHash: 'c'.repeat(64) }, async () => ({ draftId: 'draft-2' }))).rejects.toThrow('conflicting')
})
