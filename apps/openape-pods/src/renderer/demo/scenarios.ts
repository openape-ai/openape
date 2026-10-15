import { normalizeTags } from '../../contracts/tags'
import type { CentralPod } from '../../contracts/central'
import type { DomainOverview } from '../../contracts/domain-admin'
import type { MapView } from '../../contracts/map-view'
import type { StoredPod } from '../../contracts/control'

export const scenarioNames = ['everyday', 'attention', 'empty', 'loading-error'] as const
export type DemoScenario = typeof scenarioNames[number]
export const demoId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
export const demoHash = 'a'.repeat(64)

export interface DemoState {
  pods: StoredPod[]
  views: Record<string, CentralPod>
  tags: Record<string, string[]>
  domain: DomainOverview
}

const examples = [
  ['Rechnungseingang', 'Prüft neue Rechnungen und fragt bei unbekannten Lieferanten nach.', 'Northwind', 'invoices'],
  ['Newsletter-Sortierung', 'Sortiert Newsletter nach deinen Regeln und hält unklare Nachrichten zurück.', 'Northwind', 'newsletters'],
  ['Release-Beobachtung', 'Prüft neue Versionen und fasst relevante Änderungen zusammen.', 'Northwind', 'releases'],
  ['Morgenbriefing', 'Fasst Termine und offene Aufgaben für den Arbeitstag zusammen.', 'Contoso', 'briefing'],
  ['Belegablage', 'Ordnet geprüfte Rechnungen dem richtigen Monat zu.', 'Contoso', 'filing'],
  ['Wochenbericht', 'Erstellt freitags einen Überblick über abgeschlossene Arbeiten.', 'Contoso', 'reports'],
] as const

function podView(pod: StoredPod, description: string, topic: string, at: number): CentralPod {
  const versions = [{ hash: demoHash, assignmentRevision: 1, validated: true, active: true }]
  const runs = Array.from({ length: 3 }, (_, index) => ({
    id: demoId(100 + examples.findIndex(example => example[0] === pod.name) * 10 + index),
    podId: pod.id,
    scriptHash: demoHash,
    state: 'completed' as const,
    startedAt: at - (index + 1) * 3600000,
    finishedAt: at - (index + 1) * 3600000 + 24000,
    summary: index ? 'Keine neuen Einträge. Alles auf dem aktuellen Stand.' : '12 Einträge geprüft, 2 zur Entscheidung vorgelegt.',
    error: null,
    checkpointRevision: 1,
    recovery: null,
  }))
  const events = [{ sequence: 1, type: 'log', data: { line: 'Demo: 12 synthetische Einträge eingelesen.' }, at: runs[0]!.startedAt }]
  return {
    id: pod.id,
    ready: true,
    details: { description: { text: description, revision: 1, state: 'ready', error: null, updatedAt: at }, claims: [], counts: { finding: 0, question: 0, gap: 0 }, total: 0, checkpointRevision: 1, versions, source: null },
    scripts: { pod, resourceEpoch: 1, credentialAliases: [], versions, drafts: [], environment: { PODS_POD_ID: pod.id, HOME: '/demo/home' }, source: { kind: 'version', id: demoHash, hash: demoHash, assignmentRevision: 1, revision: 1, validated: true, evidence: null, credentialAccessApproved: true, capabilities: [], code: `export async function run(context) {\n  // Synthetic example; never executed by the UI demo.\n  const topic = context.variables.topic\n  return { status: 'completed', summary: topic, completedInputIds: [], gapIds: [] }\n}\n` } },
    resources: { epoch: 1, directories: { home: '/demo/home', workspace: `/demo/${topic}` }, resources: [{ id: demoId(500 + Number(pod.id.slice(-2))), podId: pod.id, revision: 1, kind: 'directory', state: 'ready', name: 'Demo-Unterlagen', configuration: { path: `/demo/${topic}`, access: 'read' } }], variables: [{ name: 'topic', value: topic, revision: 1 }] },
    scheduling: { spec: { kind: 'interval', seconds: 1800 }, enabled: true, revision: 1, nextAt: at + 1800000, error: null, pending: 0, blocked: 0, concurrency: 2 },
    runs: { runs, events },
    versions: {},
    history: Object.fromEntries(runs.map(run => [run.id, { runs: [run], events }])),
  }
}

export function demoState(scenario: DemoScenario, at: number): DemoState {
  const state: DemoState = { pods: [], views: {}, tags: {}, domain: { namespaces: [], operations: [], questions: [], approvals: [], held: [], unknownEffects: [] } }
  if (scenario === 'empty') return state
  examples.forEach(([name, description, company, topic], index) => {
    const pod: StoredPod = { id: demoId(index + 1), name, revision: 1, lifecycle: index === 4 ? 'paused' : 'active', activeScript: demoHash }
    state.pods.push(pod); state.tags[pod.id] = normalizeTags([company, index < 2 ? 'Mail' : 'Betrieb'])
    state.views[pod.id] = podView(pod, description, topic, at)
  })
  state.domain.questions = Array.from({ length: 4 }, (_, index) => ({
    id: `demo-question-${index + 1}`,
    podId: demoId(index < 2 ? 1 : 2),
    namespace: 'demo/mail',
    key: `message-${index + 1}`,
    title: index < 2 ? 'Unbekannter Lieferant' : 'Newsletter einordnen',
    body: ['Soll die Rechnung von Bergblick Büroservice zur Belegablage?', 'Soll die Rechnung von Stadtrad Logistik zur Belegablage?', 'Wie soll der Newsletter von Design Weekly behandelt werden?', 'Wie soll der Newsletter von Product Notes behandelt werden?'][index]!,
    options: [{ key: 'keep', title: 'Behalten' }, { key: 'archive', title: 'Archivieren' }],
    data: { sender: ['billing@bergblick.invalid', 'invoice@stadtrad.invalid', 'news@design.invalid', 'team@product.invalid'][index]!, organization: 'Northwind', amount: index < 2 ? `${(index + 1) * 149},00 EUR` : '–' },
    createdAt: at - (index + 1) * 60000,
  }))
  if (scenario === 'attention') {
    const run = state.views[demoId(3)]!.runs.runs[0]!
    run.state = 'failed'; run.summary = 'Versionsprüfung konnte nicht abgeschlossen werden.'; run.error = 'Demo service temporarily unavailable'; run.recovery = { state: 'ready', error: null }
    state.views[demoId(3)]!.runs.events.push({ sequence: 2, type: 'log', data: { line: 'Demo: Der Dienst hat nach 30 Sekunden nicht geantwortet.' }, at: at - 3570000 })
    state.domain.approvals = [{ id: demoId(900), podId: demoId(5), action: 'mail.archive', object: 'demo-invoice-42', title: 'Geprüfte Rechnung archivieren', description: 'Einmalige Freigabe für eine synthetische Rechnung.', link: null, state: 'requested', reason: null, batchId: demoId(901), batchUrl: 'https://id.example.invalid/demo', updatedAt: at }]
  }
  return state
}

export function demoMap(state: DemoState, at: number): MapView {
  const pods = state.pods.map((pod) => {
    const view = state.views[pod.id]!
    const last = view.runs.runs[0]
    return {
      ...pod,
      script: pod.activeScript,
      description: view.details.description?.text ?? null,
      draft: false,
      kind: 'code' as const,
      ai: pod.id === demoId(4),
      data: { writes: [`demo/${pod.id.slice(-1)}/results`], reads: pod.id === demoId(5) ? ['demo/1/results'] : [] },
      work: { pending: 0, held: 0 },
      resources: [{ kind: 'service' as const, name: 'Demo API', how: 'Read', system: 'demo-api' }],
      secrets: [],
      schedule: view.scheduling,
      lastRun: last ? { at: last.startedAt, state: last.state, summary: last.summary, error: last.error } : null,
      runs: view.runs.runs.length,
      queue: { blocked: 0, error: null },
      approvals: [],
      unknown: [],
      failures: view.runs.runs.filter(run => run.state === 'failed').length,
      tags: { own: state.tags[pod.id] ?? [], revision: pod.revision },

    }
  })
  return {
    at,
    window: { from: at - 86400000, to: at },
    pods,
    systems: [{ id: 'demo-api', kind: 'service', name: 'Demo API', how: 'Read' }],
    edges: [...pods.map(pod => ({ from: 'demo-api', to: pod.id, type: 'read' as const, channel: null, flow: 12 })), ...(pods.length ? [{ from: demoId(1), to: demoId(5), type: 'data' as const, channel: 'demo/1/results', flow: 12 }] : [])],
    kpis: { active: pods.filter(pod => pod.lifecycle === 'active').length, paused: pods.filter(pod => pod.lifecycle === 'paused').length, degraded: pods.filter(pod => pod.lastRun?.state === 'failed').map(pod => ({ podId: pod.id, reason: pod.lastRun!.summary })), decisions: [...state.domain.questions.map(question => ({ podId: question.podId, kind: 'question' as const, title: question.title, count: 1 })), ...state.domain.approvals.map(approval => ({ podId: approval.podId, kind: 'approval' as const, title: approval.title, count: 1 }))], unknownDeliveries: 0 },
  }
}
