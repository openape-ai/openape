import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import App from '../../src/renderer/App.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { PodVariables } from '../../src/worker/resources/variables'
import { ScriptWorkspace } from '../../src/worker/workspace/scripts'
import { MasterControl } from '../../src/worker/master/control'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { installWorkspace, podId } from '../layout/workspace-fixture'

// Formerly the packaged `values-tab` E2E. Worker contracts run against real
// SQLite; the German tab and its secret prompt render through the App shell.
const roots: string[] = []
afterEach(() => { applyLanguage('en'); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('keeps empty variables and a declared secret without assigning any access', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-values-tab-')); roots.push(root)
  const store = new PodDatabase(root)
  try {
    const pod = store.createPod({ name: 'Notification example' })
    const resources = new ResourceRegistry(store, () => {}); const runtime = {} as AgentRuntime
    const dispatcher = new RunDispatcher(store, resources, runtime)
    const scripts = new ScriptWorkspace(store, resources, new MasterControl(store, resources, dispatcher, new Scheduler(store, dispatcher), runtime))
    const variables = new PodVariables(store)
    for (const name of ['application_id', 'chat_id']) variables.save(pod.id, name, '', 0)
    await scripts.execute({ type: 'save', podId: pod.id, revision: 1, draftId: null, draftRevision: 0, code: 'export async function run(context) { return { status: "completed", summary: "Example", completedInputIds: [], gapIds: [] } }', capabilities: ['credential.notification_token'] }, new AbortController().signal)
    expect(variables.list(pod.id).map(item => [item.name, item.value])).toEqual([['application_id', ''], ['chat_id', '']])
    expect(resources.list(pod.id)).toEqual([])
  }
  finally { store.close() }
})

it('shows unset values and the missing secret in German, and keeps the secret form out of Settings', async () => {
  applyLanguage('de')
  installWorkspace({
    resources: async () => ({ resources: [], epoch: 1, variables: [{ name: 'application_id', value: '', revision: 1 }, { name: 'chat_id', value: '', revision: 1 }] }),
    scripts: async () => ({ resourceEpoch: 1, credentialAliases: ['notification_token'], pod: { id: podId, name: 'Mail knowledge', revision: 2, lifecycle: 'paused', activeScript: null }, versions: [], drafts: [], source: { kind: 'draft', id: crypto.randomUUID(), code: 'export async function run() {}', capabilities: ['credential.notification_token'], revision: 1, assignmentRevision: 1, hash: null, validated: false, evidence: null, credentialAccessApproved: false } }),
  })
  const wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  const tab = (name: string) => wrapper.findAll('[role="tab"]').find(item => item.text() === name)!
  await tab('Variablen und Geheimnisse').trigger('click'); await flushPromises()
  expect(wrapper.findAll('.value-row')).toHaveLength(2)
  expect(wrapper.findAll('.value-row').map(row => row.text()).join(' ')).toContain('Nicht hinterlegt')
  const secret = wrapper.findAll('.resource-row').find(row => row.text().includes('notification_token'))!
  await secret.findAll('button').find(button => button.text() === 'Geheimnis hinterlegen')!.trigger('click'); await flushPromises()
  expect(wrapper.get<HTMLInputElement>('[name="credential-alias"]').element.value).toBe('notification_token')
  expect(wrapper.get<HTMLInputElement>('[name="credential-value"]').element.value).toBe('')
  await tab('Einstellungen').trigger('click'); await flushPromises()
  expect(wrapper.find('.credential-form').exists()).toBe(false)
  wrapper.unmount()
})
