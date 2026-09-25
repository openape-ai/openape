import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it } from 'vitest'
import PodRuns from '../../src/renderer/PodRuns.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { parseRunView } from '../../src/contracts/runs'
import type { RunCommand } from '../../src/contracts/runs'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { RunStore } from '../../src/worker/runs/store'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { podEnvironmentValues, visibleEnvironment } from '../../src/runtime/environment'

// Formerly the packaged `readable-runs` E2E: persisted run rows go through the
// real RunStore, the worker's RunDispatcher.view and the IPC view parser, then
// render in PodRuns. Only the process boundary between them is skipped.
let root = ''; let store: PodDatabase; let runs: RunStore; let podId = ''
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-run-history-'))); store = new PodDatabase(root); runs = new RunStore(store)
  podId = store.createPod({ name: 'Synthetic digest' }).id
  const dispatcher = new RunDispatcher(store, new ResourceRegistry(store, () => {}), {} as AgentRuntime)
  window.pods = {
    workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: store.listPods() }),
    runs: async (command: RunCommand) => parseRunView(structuredClone(dispatcher.view(command.podId, 'runId' in command ? command.runId : undefined, command.type === 'list' ? command.after : undefined))),
    scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }),
  } as unknown as typeof window.pods
})
afterEach(async () => { applyLanguage('en'); store.close(); await rm(root, { recursive: true, force: true }) })
const hash = 'a'.repeat(64)
function insert(state: string, error: string | null, summary = '') {
  const id = randomUUID()
  store.db.prepare('INSERT INTO runs(id,pod_id,script_hash,state,started_at,finished_at,summary,error,checkpoint_revision,assignment_revision) VALUES(?,?,?,?,?,?,?,?,0,1)').run(id, podId, hash, state, Date.now() - 65000, state === 'running' ? null : Date.now(), summary, error)
  runs.append(id, 'started', { reason: 'manual' })
  return id
}
async function history() {
  const wrapper = mount(PodRuns, { props: { selectedPodId: podId } }); await flushPromises()
  return wrapper
}

it.each([['en', 'permission service', 'AI request'], ['de', 'nicht autorisiert', 'KI-Anfrage']] as const)('explains a persisted authorization failure without raw events or invented model steps (%s)', async (language, problem, modelStep) => {
  applyLanguage(language)
  const id = insert('failed', 'Identity authorization failed (400)', 'Script did not finish')
  runs.append(id, 'operation', { id: 'app-call', operation: 'tools.invoke', state: 'failed' })
  runs.append(id, 'finished', { state: 'failed' })
  const wrapper = await history()
  expect(wrapper.get('.run-result .run-problem').text()).toContain(problem)
  // Raw events stay behind the collapsed technical details.
  expect((wrapper.get('.event-list').element.closest('details') as HTMLDetailsElement).open).toBe(false)
  expect(wrapper.get('.run-steps').text()).not.toContain(modelStep)
  wrapper.unmount()
})

it('summarizes a storage interruption with five completed reads and no permission action (de)', async () => {
  applyLanguage('de')
  const id = insert('cancelled', 'Data inventory contains a link or unsupported file: runs/fixture/agent/confined/home/codex/tmp/arg0/fixture/apply_patch')
  for (let index = 0; index < 5; index++) {
    runs.append(id, 'operation', { id: `synthetic-${index}`, operation: 'tools.invoke', state: 'started' })
    runs.append(id, 'approval', { grantId: `synthetic-${index}`, title: 'Read synthetic mail', issuer: 'https://id.example.test', permission: 'o365.account[email=synthetic@example.invalid].mail-read[*]#read', state: 'approved' })
    runs.append(id, 'operation', { id: `synthetic-${index}`, operation: 'tools.invoke', state: 'completed' })
  }
  runs.append(id, 'operation', { id: 'ai-call', operation: 'agent.run', state: 'started' })
  const wrapper = await history()
  expect(wrapper.get('.run-result .run-problem').text()).toContain('Speicherprüfung')
  expect(wrapper.findAll('button').some(button => button.text() === 'Berechtigungen prüfen')).toBe(false)
  expect(wrapper.findAll('.run-steps li')).toHaveLength(2)
  expect(wrapper.get('.run-steps').text()).toContain('5 erfolgreich')
  wrapper.unmount()
})

const pendingGrant = () => ({ grantId: 'synthetic-grant', issuer: 'https://id.example.test', subject: 'pod@example.test', state: 'pending', title: 'Run the stored script of Synthetic digest', permission: `pod-runtime.pod[id=${podId}]#run`, openError: 'The browser could not be opened; use Open approval to try again' })
async function approvalCards() {
  const wrapper = await history()
  const cards = wrapper.findAll('.approval-card').length; const actions = wrapper.findAll('button').filter(button => button.text() === 'Freigabe öffnen').length
  wrapper.unmount(); return { cards, actions }
}

it('offers exactly one approval action while a grant is pending and drops it once the grant is approved', async () => {
  applyLanguage('de')
  const id = insert('running', null)
  runs.append(id, 'approval', pendingGrant())
  expect(await approvalCards()).toEqual({ cards: 1, actions: 1 })
  // Still running: only the newer approval event can retire the card.
  runs.append(id, 'approval', { grantId: 'synthetic-grant', issuer: 'https://id.example.test', state: 'approved', title: 'Run the stored script' })
  expect(await approvalCards()).toEqual({ cards: 0, actions: 0 })
})

it('drops a still-pending approval once its run has ended', async () => {
  applyLanguage('de')
  const id = insert('running', null)
  runs.append(id, 'approval', pendingGrant())
  expect(await approvalCards()).toEqual({ cards: 1, actions: 1 })
  store.db.prepare('UPDATE runs SET state=\'cancelled\',finished_at=?,error=\'Cancelled by owner\' WHERE id=?').run(Date.now(), id)
  expect(await approvalCards()).toEqual({ cards: 0, actions: 0 })
})

it('shows only the allow-listed pod environment, never injected or inherited secrets', () => {
  const values = { ...podEnvironmentValues(root, podId), SYNTHETIC_TOKEN: 'secret-value', OPENAI_API_KEY: 'sk-synthetic', APES_AUTH_FILE: '/Users/owner/.config/apes/auth.json' }
  const visible = visibleEnvironment(values)
  expect(visible.PODS_POD_ID).toBe(podId)
  expect(Object.keys(visible).sort()).toEqual(['ELECTRON_RUN_AS_NODE', 'HOME', 'LANG', 'PATH', 'PODS_POD_ID', 'SHELL', 'TERM', 'TMPDIR'])
  expect(JSON.stringify(visible)).not.toMatch(/secret-value|sk-synthetic|auth\.json|APES_/)
})
