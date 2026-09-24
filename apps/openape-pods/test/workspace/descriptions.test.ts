import { WorkspaceDetails } from '../../src/worker/workspace/details'
import { ResourceRegistry } from '../../src/worker/resources/registry'
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { PodDescriptions } from '../../src/worker/master/descriptions'
import { MasterConversations } from '../../src/worker/master/conversations'

const root = mkdtempSync(join(tmpdir(), 'pod-descriptions-'))
const store = new PodDatabase(root)
afterEach(() => { store.db.prepare('DELETE FROM pod_descriptions').run() })
afterAll(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
function message(podId: string, text: string, role = 'user') {
  const id = crypto.randomUUID()
  store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(id, role, text, role === 'user' ? 'sent' : 'completed', Date.now())
  new MasterConversations(store).assign(id, podId)
}

it('summarizes corrections without changing execution state and excludes tool payloads', async () => {
  const pod = store.createPod({ name: 'Example' }); const inputs: string[] = []
  const descriptions = new PodDescriptions(store, async (input) => { inputs.push(input); return inputs.length === 1 ? 'Checks every 15 minutes.' : 'Checks every 30 minutes.' })
  message(pod.id, 'Check every 15 minutes'); message(pod.id, 'Protected application details', 'tool')
  descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  message(pod.id, 'Actually, every 30 minutes.'); descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  expect(descriptions.view(pod.id)).toMatchObject({ state: 'ready', text: 'Checks every 30 minutes.', revision: 2 })
  expect(inputs[1]).toContain('Checks every 15 minutes.'); expect(inputs[1]).toContain('Actually, every 30 minutes.')
  expect(inputs.join('')).not.toContain('Protected application details')
  expect(store.getPod(pod.id)).toEqual(pod)
})

it('does not publish a stale summary when new conversation arrives during generation', async () => {
  const pod = store.createPod({ name: 'Concurrent' }); let calls = 0
  const descriptions = new PodDescriptions(store, async () => {
    calls++
    if (calls === 1) { message(pod.id, 'Use 30 minutes'); descriptions.request(pod.id); return 'Obsolete description' }
    expect(descriptions.view(pod.id)?.text).toBe(''); return 'Current description'
  })
  message(pod.id, 'Use 15 minutes'); descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  expect(descriptions.view(pod.id)).toMatchObject({ text: 'Current description', state: 'ready', revision: 1 }); expect(calls).toBe(2)
})

it('retains the last description on failure and resumes all messages beyond the visible history window', async () => {
  const pod = store.createPod({ name: 'Long conversation' }); let fail = false; let seen = 0
  const descriptions = new PodDescriptions(store, async (input) => {
    if (fail) throw new Error('Synthetic model unavailable')
    seen += (JSON.parse(input) as { conversation: unknown[] }).conversation.length
    return 'Summary of completed segments'
  })
  message(pod.id, 'Initial'); descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  for (let i = 0; i < 205; i++) message(pod.id, `Correction ${i}`)
  fail = true; descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  expect(descriptions.view(pod.id)).toMatchObject({ text: 'Summary of completed segments', state: 'failed', error: 'Synthetic model unavailable' })
  fail = false; descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  expect(descriptions.view(pod.id)?.state).toBe('ready'); expect(seen).toBe(206)
})

it('segments an oversized message without dropping text and resumes after an interrupted segment', async () => {
  const pod = store.createPod({ name: 'Large message' }); const original = `Start ${'Long request 🦍 '.repeat(6000)} End`; let seen = ''; let calls = 0; let fail = true
  const descriptions = new PodDescriptions(store, async (input) => {
    calls++
    if (fail && calls === 2) throw new Error('Synthetic interruption')
    const segment = JSON.parse(input) as { conversation: { text: string }[] }
    seen += segment.conversation.map(message => message.text).join(''); return 'Summary'
  })
  message(pod.id, original); descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  expect(descriptions.view(pod.id)).toMatchObject({ state: 'failed', text: '' })
  fail = false; descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  expect(seen).toBe(original); expect(descriptions.view(pod.id)).toMatchObject({ state: 'ready', revision: 1 })
})

it('explicitly regenerates a ready description from its original conversation while retaining the published text', async () => {
  const pod = store.createPod({ name: 'Refresh' }); let calls = 0
  const descriptions = new PodDescriptions(store, async (input) => {
    calls++; expect(input).toContain('Original request')
    if (calls === 2) expect(descriptions.view(pod.id)?.text).toBe('Previous summary')
    return calls === 1 ? 'Previous summary' : 'A concise replacement'
  })
  message(pod.id, 'Original request'); descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  descriptions.request(pod.id, true); descriptions.start(); await descriptions.idle()
  expect(descriptions.view(pod.id)).toMatchObject({ state: 'ready', text: 'A concise replacement', revision: 2 })
  expect(calls).toBe(2); expect(store.getPod(pod.id)).toEqual(pod)
})

it('does not overwrite a manual edit when a legacy summary finishes later', async () => {
  const pod = store.createPod({ name: 'Manual description' })
  const details = new WorkspaceDetails(store, new ResourceRegistry(store, () => {}))
  const descriptions = new PodDescriptions(store, async () => {
    details.execute({ type: 'describe', podId: pod.id, revision: 0, text: 'Owner purpose' })
    return 'Stale generated purpose'
  })
  message(pod.id, 'Original request'); descriptions.request(pod.id); descriptions.start(); await descriptions.idle()
  expect(descriptions.view(pod.id)).toMatchObject({ text: 'Owner purpose', revision: 1 })
  descriptions.request(pod.id, true); descriptions.start(); await descriptions.idle()
  expect(descriptions.view(pod.id)).toMatchObject({ text: 'Owner purpose', revision: 1 })
})
