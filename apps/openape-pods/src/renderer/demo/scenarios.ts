import { normalizeTags } from '../../contracts/tags'
import type { CentralPod } from '../../contracts/central'
import type { ApprovalHistoryView } from '../../contracts/approval-history'
import type { MapView } from '../../contracts/map-view'
import type { StoredPod } from '../../contracts/control'
import type { InboxMessage } from '../../contracts/inbox'

export const scenarioNames = ['everyday', 'attention', 'empty', 'loading-error'] as const
export type DemoScenario = typeof scenarioNames[number]
export const demoId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
export const demoHash = 'a'.repeat(64)

export interface DemoState {
  pods: StoredPod[]
  views: Record<string, CentralPod>
  tags: Record<string, string[]>
  approvalHistory: ApprovalHistoryView
  messages: InboxMessage[]
}

const examples = [
  ['Rechnungseingang', 'Prüft neue Rechnungen und fragt bei unbekannten Lieferanten nach.', 'Northwind', 'invoices'],
  ['Newsletter-Sortierung', 'Sortiert Newsletter nach deinen Regeln und hält unklare Nachrichten zurück.', 'Northwind', 'newsletters'],
  ['Release-Beobachtung', 'Prüft neue Versionen und fasst relevante Änderungen zusammen.', 'Northwind', 'releases'],
  ['Morgenbriefing', 'Fasst Termine und offene Aufgaben für den Arbeitstag zusammen.', 'Contoso', 'briefing'],
  ['Belegablage', 'Ordnet geprüfte Rechnungen dem richtigen Monat zu.', 'Contoso', 'filing'],
  ['Wochenbericht', 'Erstellt freitags einen Überblick über abgeschlossene Arbeiten.', 'Contoso', 'reports'],
] as const

// Everyday-only edge cases: [name, description, company, topic, lifecycle, failed run indices (0 = latest), failure summary, error]
const edgeCases = [
  ['Lieferantenabgleich', 'Gleicht Lieferantenstammdaten mit der Buchhaltung ab.', 'Northwind', 'suppliers', 'active', [0, 1], 'Lieferantenliste konnte nicht geladen werden.', 'HTTP 503 from demo-api after 3 attempts'],
  ['Kontoabgleich', 'Ordnet Kontobewegungen offenen Rechnungen zu.', 'Contoso', 'banking', 'active', [2], 'Kontoauszug war unvollständig.', 'Statement ends before requested date'],
  ['Mahnwesen', 'Erinnert Kunden an überfällige Rechnungen.', 'Contoso', 'dunning', 'paused', [0], 'Vorlage für die Mahnung fehlt.', 'Template dunning-2 not found'],
  ['Altes Ticketsystem', 'Hat Supportanfragen aus dem abgelösten Ticketsystem übernommen.', 'Northwind', 'tickets', 'archived', [], '', ''],
  ['Steuerexport 2025', 'Hat die Belege für die Steuererklärung 2025 exportiert.', 'Contoso', 'tax', 'archived', [0], 'Export wurde vom Zielsystem abgelehnt.', 'Export rejected: period closed'],
] as const

function podView(pod: StoredPod, description: string, topic: string, at: number, failure?: { runs: readonly number[], summary: string, error: string }): CentralPod {
  const versions = [{ hash: demoHash, assignmentRevision: 1, validated: true, active: true }]
  const runs = Array.from({ length: 3 }, (_, index) => {
    const failed = failure?.runs.includes(index) ? failure : null
    return {
      id: demoId(100 + (Number(pod.id.slice(-2)) - 1) * 10 + index),
      podId: pod.id,
      scriptHash: demoHash,
      state: failed ? 'failed' as const : 'completed' as const,
      startedAt: at - (index + 1) * 3600000,
      finishedAt: at - (index + 1) * 3600000 + 24000,
      summary: failed ? failed.summary : index ? 'Keine neuen Einträge. Alles auf dem aktuellen Stand.' : '12 Einträge geprüft, 2 zur Entscheidung vorgelegt.',
      error: failed?.error ?? null,
      checkpointRevision: 1,
      recovery: null,
    }
  })
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
  const state: DemoState = { pods: [], views: {}, tags: {}, approvalHistory: { approvals: [] }, messages: [] }
  if (scenario === 'empty') return state
  examples.forEach(([name, description, company, topic], index) => {
    const pod: StoredPod = { id: demoId(index + 1), name, revision: 1, lifecycle: index === 4 ? 'paused' : 'active', activeScript: demoHash }
    state.pods.push(pod); state.tags[pod.id] = normalizeTags([company, index < 2 ? 'Mail' : 'Betrieb'])
    state.views[pod.id] = podView(pod, description, topic, at)
  })
  if (scenario === 'everyday') {
    edgeCases.forEach(([name, description, company, topic, lifecycle, runs, summary, error], index) => {
      const pod: StoredPod = { id: demoId(examples.length + index + 1), name, revision: 1, lifecycle, activeScript: demoHash }
      const archived = lifecycle === 'archived'
      state.pods.push(pod); state.tags[pod.id] = normalizeTags([company, 'Betrieb'])
      const view = podView(pod, description, topic, archived ? at - 30 * 86400000 : at, { runs, summary, error })
      if (archived) view.scheduling = { ...view.scheduling, enabled: false, nextAt: null }
      state.views[pod.id] = view
    })
  }
  // Index of the sending Pod, minutes ago, read, archived, title, body, links.
  const notes: [number, number, boolean, boolean, string, string, string[]][] = [
    [3, 4, false, false, 'Morgenbriefing für heute', '3 Termine, davon 1 extern (10:30 Lieferantengespräch Bergblick).\n5 offene Aufgaben, 2 davon heute fällig.\nKeine Konflikte im Kalender.', ['Kalender öffnen']],
    [2, 38, false, false, 'Neue Version 4.2 verfügbar', 'Die Demo-Bibliothek hat Version 4.2 veröffentlicht. Relevant: geänderte Standardwerte beim Export und ein Sicherheitsfix. Keine Aktion nötig, die Pods verwenden die Bibliothek nicht direkt.', ['Release Notes', 'Vergleich 4.1…4.2']],
    [0, 95, true, false, '2 Rechnungen abgelegt', 'Bergblick Büroservice (149,00 EUR) und Stadtrad Logistik (298,00 EUR) wurden geprüft und in die Belegablage übernommen.', []],
    [1, 260, true, false, 'Newsletter-Zusammenfassung', '14 Newsletter sortiert, 3 als wichtig markiert, 2 zur Entscheidung zurückgehalten.', []],
    [5, 2900, true, false, 'Wochenbericht KW 41', '23 abgeschlossene Arbeiten, 2 offene Rückfragen. Der vollständige Bericht liegt im Demo-Ordner.', ['Bericht öffnen']],
    [2, 7300, true, true, 'Neue Version 4.1 verfügbar', 'Kleinere Fehlerbehebungen ohne Auswirkungen.', []],
  ]
  state.messages = notes.map(([pod, minutes, read, archived, title, body, links], index) => ({
    id: demoId(700 + index),
    title,
    body,
    pod: { id: demoId(pod + 1), name: examples[pod]![0], tags: state.tags[demoId(pod + 1)] },
    runId: null,
    links: links.map(link => ({ title: link, url: 'https://example.invalid/demo' })),
    created: at - minutes * 60000,
    read: read ? at - minutes * 60000 + 60000 : null,
    archived: archived ? at - minutes * 60000 + 120000 : null,
  }))
  if (scenario === 'attention') {
    const run = state.views[demoId(3)]!.runs.runs[0]!
    run.state = 'failed'; run.summary = 'Versionsprüfung konnte nicht abgeschlossen werden.'; run.error = 'Demo service temporarily unavailable'
    state.views[demoId(3)]!.runs.events.push({ sequence: 2, type: 'log', data: { line: 'Demo: Der Dienst hat nach 30 Sekunden nicht geantwortet.' }, at: at - 3570000 })
    state.approvalHistory.approvals = [{ id: demoId(900), podId: demoId(5), action: 'mail.archive', object: 'demo-invoice-42', title: 'Geprüfte Rechnung archivieren', description: 'Einmalige Freigabe für eine synthetische Rechnung.', link: null, state: 'requested', reason: null, batchId: demoId(901), batchUrl: 'https://id.example.invalid/demo', updatedAt: at }]
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
      data: { writes: [], reads: [] },
      work: { pending: 0, held: 0 },
      resources: [{ kind: 'service' as const, name: 'Demo API', how: 'Read', system: 'demo-api' }],
      secrets: [],
      schedule: view.scheduling,
      lastRun: last ? { at: last.startedAt, state: last.state, summary: last.summary, error: last.error } : null,
      runs: view.runs.runs.length,
      approvals: [],
      failures: view.runs.runs.filter(run => run.state === 'failed' && run.startedAt >= at - 86400000).length,
      tags: { own: state.tags[pod.id] ?? [], revision: pod.revision },

    }
  })
  // Same rules as the worker's map view: settled run states, and paused counts every Pod without a running schedule.
  const settled = ({ id }: { id: string }) => state.views[id]!.runs.runs.find(run => run.finishedAt !== null)?.state ?? ''
  const active = pods.filter(pod => pod.lifecycle === 'active' && pod.schedule.enabled).length
  return {
    at,
    window: { from: at - 86400000, to: at },
    pods,
    systems: [{ id: 'demo-api', kind: 'service', name: 'Demo API', how: 'Read' }],
    edges: [...pods.map(pod => ({ from: 'demo-api', to: pod.id, type: 'read' as const, channel: null, flow: 12 }))],
    kpis: { active, paused: pods.length - active, degraded: pods.filter(pod => pod.lifecycle !== 'archived' && ['failed', 'completedWithGaps'].includes(settled(pod))).map(pod => ({ podId: pod.id, reason: settled(pod) })), decisions: [...state.approvalHistory.approvals.map(approval => ({ podId: approval.podId, kind: 'approval' as const, title: approval.title, count: 1 }))] },
  }
}
