import { ref } from 'vue'
import { t } from '../i18n'
import type { PodsBridge, PodStatus } from '../../contracts/ipc'
import type { CentralPod } from '../../contracts/central'
import { parseCommand } from '../../contracts/control'
import { parseDetailsCommand } from '../../contracts/details'
import { parseResourceCommand } from '../../contracts/resources'
import { parseScheduleCommand } from '../../contracts/scheduling'
import { parseRunCommand } from '../../contracts/runs'
import { parseDomainCommand } from '../../contracts/domain-admin'
import { inboxMessageLimits, parseInboxMessagePage } from '../../contracts/inbox'
import { demoId, demoHash, demoState, demoMap } from './scenarios'
import type { DemoScenario } from './scenarios'

export function createDemoAdapter(scenario: DemoScenario, notify: (message: string) => void = () => {}) {
  const state = demoState(scenario, Date.now())
  const revision = ref(0)
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const pendingReads = new Map<ReturnType<typeof setTimeout>, (error: Error) => void>()
  let disposed = false
  let failRead = scenario === 'loading-error'
  let failChoice = scenario === 'attention'
  let runSequence = 1000
  let language: 'de' | 'en' = 'de'

  function changed() { revision.value++ }
  function unavailable(action: string): never { throw new Error(`Demo: ${action} is unavailable here. Nothing outside the demo was changed.`) }
  function view(id: string): CentralPod {
    if (disposed) throw new Error('Demo session ended')
    const found = state.views[id]
    if (!found) throw new Error('Demo Pod not found')
    return found
  }
  function checkRevision(actual: number, expected: number) {
    if (actual !== expected) throw new Error('Revision conflict. Reload the current state before saving.')
  }
  function snapshot() { return structuredClone({ pods: state.pods, tags: state.pods.map(pod => ({ id: pod.id, tags: state.tags[pod.id] ?? [], revision: pod.revision })) }) }
  function delay(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pendingReads.delete(timer); resolve() }, ms)
      pendingReads.set(timer, reject)
    })
  }
  function finish(pod: CentralPod, runId: string) {
    const run = pod.runs.runs.find(item => item.id === runId)
    if (!run || run.state !== 'running') return
    run.state = 'completed'; run.finishedAt = Date.now(); run.summary = 'Demo abgeschlossen: 12 Einträge geprüft. Keine externen Aktionen ausgeführt.'
    pod.runs.events.push({ sequence: pod.runs.events.length + 1, type: 'log', data: { line: run.summary }, at: run.finishedAt })
    pod.history[run.id] = { runs: [run], events: [...pod.runs.events] }; changed()
  }
  function start(pod: CentralPod, expectedScript?: string) {
    if (pod.scripts.pod.lifecycle === 'archived') throw new Error('Archived Pods cannot run')
    if (expectedScript && expectedScript !== pod.scripts.pod.activeScript) throw new Error('Script changed. Reload before starting.')
    if (pod.runs.runs.some(run => run.state === 'running')) throw new Error('A run is already active')
    const run = { id: demoId(runSequence++), podId: pod.id, scriptHash: demoHash, state: 'running' as const, startedAt: Date.now(), finishedAt: null, summary: 'Demo prüft synthetische Einträge …', error: null, checkpointRevision: 1, recovery: null }
    pod.runs.runs.unshift(run)
    pod.runs.events = [{ sequence: 1, type: 'log', data: { line: 'Demo gestartet. Es wird kein Skript ausgeführt.' }, at: run.startedAt }]
    const timer = setTimeout(() => { timers.delete(timer); finish(pod, run.id) }, 900)
    timers.add(timer); changed()
  }
  const status: PodStatus = { version: 1, mode: 'fixture', executionEnabled: true, worker: { state: 'ready', pid: null, error: null }, runtime: { electron: 'demo', node: 'browser' } }
  const bridge: PodsBridge = {
    getStatus: async () => structuredClone(status),
    onStatus: () => () => {},
    language: async (command) => { if (command.type === 'set') language = command.language; return language },
    async workspace(input) {
      const command = parseCommand(input)
      if (command.type === 'map') {
        if (scenario === 'loading-error') await delay(250)
        if (failRead) throw new Error('Demo connection interrupted. Restore it from the demo toolbar.')
        return { ...snapshot(), map: demoMap(state, Date.now()) }
      }
      if (command.type === 'list') return snapshot()
      if (command.type === 'update') {
        const pod = view(command.id).scripts.pod
        checkRevision(pod.revision, command.revision)
        pod.name = command.name; pod.lifecycle = command.lifecycle; pod.revision++; changed()
        return snapshot()
      }
      if (command.type === 'tag') {
        const pod = view(command.id).scripts.pod
        checkRevision(pod.revision, command.revision)
        state.tags[pod.id] = [...command.tags]; pod.revision++; changed()
        return snapshot()
      }
      return unavailable(command.type)
    },
    async details(input) {
      const command = parseDetailsCommand(input)
      const pod = view(command.podId)
      if (command.type === 'describe') {
        checkRevision(pod.details.description?.revision ?? 0, command.revision)
        pod.details.description = { text: command.text, revision: command.revision + 1, state: 'ready', error: null, updatedAt: Date.now() }; changed()
      }
      else if (command.type !== 'list') {
        return unavailable(command.type)
      }
      return structuredClone(pod.details)
    },
    async resources(input) {
      const command = parseResourceCommand(input)
      const pod = view(command.podId)
      const variables = pod.resources.variables!
      if (command.type === 'saveVariable') {
        const existing = variables.find(item => item.name === command.name)
        checkRevision(existing?.revision ?? 0, command.revision)
        if (existing) { existing.value = command.value; existing.revision++ }
        else {
          variables.push({ name: command.name, value: command.value, revision: 1 })
        }
        changed()
      }
      else if (command.type === 'removeVariable') {
        const index = variables.findIndex(item => item.name === command.name)
        if (index < 0) throw new Error('Variable not found')
        checkRevision(variables[index]!.revision, command.revision); variables.splice(index, 1); changed()
      }
      else if (!['list', 'sandbox'].includes(command.type)) {
        return unavailable(command.type)
      }
      return structuredClone(pod.resources)
    },
    async scheduling(input) {
      const command = parseScheduleCommand(input)
      const pod = view(command.podId)
      if (command.type === 'save') {
        checkRevision(pod.scheduling.revision, command.revision)
        pod.scheduling.spec = command.spec; pod.scheduling.enabled = command.enabled; pod.scheduling.revision++
        pod.scheduling.nextAt = command.enabled ? Date.now() + (command.spec.kind === 'interval' ? command.spec.seconds : 86400) * 1000 : null
        changed()
      }
      else if (command.type === 'lifecycle') {
        checkRevision(pod.scripts.pod.revision, command.revision)
        pod.scripts.pod.lifecycle = command.lifecycle; pod.scripts.pod.revision++; changed()
      }
      else if (command.type === 'concurrency') { pod.scheduling.concurrency = command.maximum; changed() }
      return structuredClone(pod.scheduling)
    },
    async runs(input) {
      const command = parseRunCommand(input)
      const pod = view(command.podId)
      if (command.type === 'start') {
        start(pod, command.expectedScript)
      }
      else if (command.type === 'cancel') {
        const run = pod.runs.runs.find(run => run.id === command.runId)
        if (!run || run.state !== 'running') throw new Error('Run is not active')
        run.state = 'cancelled'; run.finishedAt = Date.now(); changed()
      }
      else if (command.type === 'recover') {
        const run = pod.runs.runs.find(run => run.id === command.runId)
        if (!run) throw new Error('Run not found')
        if (command.action === 'retry') {
          start(pod)
        }
        else { run.recovery = { state: 'ready', error: null }; changed() }
      }
      else if (command.type !== 'list') {
        return unavailable(command.type)
      }
      const result = structuredClone(pod.runs)
      if (command.type === 'list' && command.runId) result.events = structuredClone(pod.history[command.runId]?.events ?? pod.runs.events)
      return result
    },
    async scripts(command) {
      if (command.type !== 'list') return unavailable('Editing or executing scripts')
      return structuredClone(view(command.podId).scripts)
    },
    async messages(command) {
      if (failRead) throw new Error('Demo connection interrupted. Restore it from the demo toolbar.')
      if (command.type === 'mark') {
        const message = state.messages.find(item => item.id === command.id)
        if (!message) throw new Error('Demo message not found')
        if (command.deleted) state.messages.splice(state.messages.indexOf(message), 1)
        if (command.read !== undefined) message.read = command.read ? Date.now() : null
        if (command.archived !== undefined) message.archived = command.archived ? Date.now() : null
        changed()
        return null
      }
      // Pages like the relay, newest first; the demo's creation times are unique and serve as the cursor.
      const view = state.messages.filter(item => !!item.archived === !!command.archived && item.created < (command.before ?? Infinity)).sort((a, b) => b.created - a.created)
      const page = view.slice(0, inboxMessageLimits.page)
      return parseInboxMessagePage(structuredClone({ messages: page, next: view.length > page.length ? page.at(-1)!.created : null }))
    },
    async domain(input) {
      const command = parseDomainCommand(input)
      if (command.type === 'answer') {
        const index = state.domain.questions.findIndex(question => question.id === command.questionId)
        if (index < 0) throw new Error('Question was already answered')
        if (!state.domain.questions[index]!.options.some(option => option.key === command.option)) throw new Error('Unknown answer')
        if (failChoice) { failChoice = false; throw new Error('Demo: Saving failed. Try the same decision again.') }
        state.domain.questions.splice(index, 1); changed()
      }
      else if (command.type === 'resolveEffect') {
        const index = state.domain.unknownEffects.findIndex(effect => effect.actionKey === command.actionKey && effect.attempt === command.attempt)
        if (index < 0) throw new Error('Only an uncertain effect can be reconciled')
        state.domain.unknownEffects.splice(index, 1); changed()
      }
      else if (command.type === 'openApproval') { notify(t('Demo: This approval would be decided at the IdP. No permission was granted.')); return null }
      else if (command.type !== 'list') {
        return unavailable(command.type)
      }
      return structuredClone(state.domain)
    },
    async onboarding(command) {
      if (command.type !== 'list') return unavailable('Authentication or permissions')
      return {
        connections: [{ id: 'demo-owner', provider: 'openape', account: 'owner@example.invalid', state: 'ready', error: null, login: null }],
        owner: 'demo-owner',
        runtime: { ready: true, error: null },
        complete: true,
        ...command.podId ? { podIdentity: { podId: command.podId, bound: true, ownerConnection: 'demo-owner', issuer: 'https://id.example.invalid', decisionIssuer: 'https://id.example.invalid', subject: `demo:${command.podId}`, brokerConnectionId: null } } : {},
      }
    },
    async programs(command) {
      if (command.type === 'launchStatus') return null
      return unavailable('Opening an editor, terminal or application')
    },
    async definitions(command) { if (command.type !== 'list') return unavailable(command.type); return { definitions: [], instances: [], provisioning: [] } },
    async codex(command) { if (command.type !== 'status') return unavailable('Connecting Codex'); return { state: 'disconnected', home: '/demo', manual: '' } },
    async mcpSession(command) { if (command.type !== 'get') return unavailable('MCP session'); return { expiresAt: null, pending: false } },
    async master() { return unavailable('Assistant action') },
    async packages() { return unavailable('Package search') },
    async data(command) {
      if (command.type !== 'status') return unavailable('Data management')
      return { usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }
    },
  }
  return {
    bridge,
    revision,
    restoreConnection() { failRead = false; changed() },
    dispose() {
      disposed = true
      for (const timer of timers) clearTimeout(timer)
      for (const [timer, reject] of pendingReads) { clearTimeout(timer); reject(new Error('Demo session ended')) }
      timers.clear(); pendingReads.clear()
    },
  }
}
