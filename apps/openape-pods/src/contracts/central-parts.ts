import { createHash } from 'node:crypto'
import { parseWorkspace } from './control'
import type { WorkspaceState } from './control'
import { parsePodDetails } from './details'
import { parseResourceState } from './resources'
import { parseRunView } from './runs'
import type { RunEvent, RunRecord, RunView } from './runs'
import { parseScheduleView } from './scheduling'
import { parseScriptView } from './scripts'
import type { ScriptView } from './scripts'
import { centralId, centralMaxBytes, centralObject, centralRevision, centralTables } from './central'
import type { CentralPod, CentralSnapshot } from './central'

// Format 2 publishes a snapshot as content-addressed parts. Only parts whose hash
// changed travel; the manifest digest replaces the full-snapshot hash.
export const centralFormat = 2
export const centralChunkRows = 16
export type CentralManifest = Record<string, string>
export type CentralParts = Map<string, unknown>
type PodPart = Omit<CentralPod, 'runs' | 'versions' | 'history'> & { runs: Omit<RunView, 'runs' | 'events'> & { runIds: string[] } }

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const keyPattern = new RegExp(`^(?:workspace|artifacts|schema|pod/(${uuid})(?:/(version|run|events)/([a-f0-9-]{36}|[a-f0-9]{64}))?|table/([a-z_]{1,64})/(\\d{1,7}))$`)
export const partHash = (text: string): string => createHash('sha256').update(text).digest('hex')

export function manifestDigest(manifest: CentralManifest): string {
  return partHash(JSON.stringify(Object.keys(manifest).sort().map(key => [key, manifest[key]])))
}

export function splitSnapshot(snapshot: CentralSnapshot): CentralParts {
  const parts: CentralParts = new Map<string, unknown>([['workspace', snapshot.workspace], ['artifacts', snapshot.artifacts], ['schema', snapshot.archive.schema]])
  for (const pod of snapshot.pods) {
    const { versions, history, runs: { runs, events: _events, ...view }, ...rest } = pod
    parts.set(`pod/${pod.id}`, { ...rest, runs: { ...view, runIds: runs.map(run => run.id) } } satisfies PodPart)
    for (const [selection, version] of Object.entries(versions)) parts.set(`pod/${pod.id}/version/${selection}`, version)
    for (const run of runs) {
      parts.set(`pod/${pod.id}/run/${run.id}`, run)
      parts.set(`pod/${pod.id}/events/${run.id}`, history[run.id]?.events ?? [])
    }
  }
  for (const [table, rows] of Object.entries(snapshot.archive.tables)) {
    for (let index = 0; index === 0 || index * centralChunkRows < rows.length; index++) parts.set(`table/${table}/${index}`, rows.slice(index * centralChunkRows, (index + 1) * centralChunkRows))
  }
  return parts
}

export function encodeParts(parts: CentralParts): Map<string, { hash: string, text: string }> {
  return new Map(Array.from(parts, ([key, value]) => { const text = JSON.stringify(value); return [key, { hash: partHash(text), text }] }))
}

export function podRuns(read: (key: string) => unknown, podId: string, runIds: string[]): RunRecord[] {
  return runIds.map(id => read(`pod/${podId}/run/${id}`) as RunRecord)
}

export function assemblePod(read: (key: string) => unknown, keys: string[], podId: string): CentralPod {
  const { runs: { runIds, ...view }, ...rest } = read(`pod/${podId}`) as PodPart
  const runs = podRuns(read, podId, runIds)
  const events = (id: string) => read(`pod/${podId}/events/${id}`) as RunEvent[]
  const prefix = `pod/${podId}/version/`
  return {
    ...rest,
    runs: { ...view, runs, events: runs[0] ? events(runs[0].id) : [] },
    versions: Object.fromEntries(keys.filter(key => key.startsWith(prefix)).map(key => [key.slice(prefix.length), read(key) as ScriptView])),
    history: Object.fromEntries(runs.map(run => [run.id, { runs: [run], events: events(run.id) }])),
  }
}

export function assembleSnapshot(read: (key: string) => unknown, keys: string[]): CentralSnapshot {
  const workspace = read('workspace') as WorkspaceState
  const tables: Record<string, Record<string, unknown>[]> = {}
  const chunks = keys.map(key => keyPattern.exec(key)).filter(match => match?.[4]).map(match => ({ key: match![0], table: match![4]!, index: Number(match![5]) }))
  for (const chunk of chunks.sort((a, b) => a.index - b.index)) (tables[chunk.table] ??= []).push(...read(chunk.key) as Record<string, unknown>[])
  return { version: 1, workspace, pods: workspace.pods.map(pod => assemblePod(read, keys, pod.id)), archive: { schema: read('schema') as number, tables }, artifacts: read('artifacts') as CentralSnapshot['artifacts'] }
}

export function parsePartKey(key: string): { podId?: string, kind?: string, id?: string, table?: string } {
  const match = keyPattern.exec(key)
  if (!match || (match[4] && !(centralTables as readonly string[]).includes(match[4]))) throw new Error('Invalid workspace part key')
  return { podId: match[1], kind: match[2] ?? (match[1] ? 'pod' : undefined), id: match[3], table: match[4] }
}

// Validates one part on its own; cross-part bindings are checked by validateManifest.
export function validatePart(key: string, value: unknown): void {
  const { podId, kind, id, table } = parsePartKey(key)
  if (key === 'workspace') { parseWorkspace(value); if ((value as WorkspaceState).pods.length > 100) throw new Error('Invalid workspace inventory'); return }
  if (key === 'schema') { centralRevision(value); return }
  if (key === 'artifacts') {
    if (!Array.isArray(value) || value.length > 100000) throw new Error('Invalid workspace artifacts')
    const paths = new Set<string>()
    for (const item of value) {
      const file = centralObject(item)
      const path = typeof file.path === 'string' ? file.path : ''
      const managed = /^blobs\/[a-f0-9]{64}$/.test(path) || (path.startsWith('workspace/') && path.split('/').every(part => !!part && part !== '.' && part !== '..'))
      centralId(file.podId)
      if (!managed || path.includes('\\') || path.includes('\0') || path.length > 4096 || typeof file.hash !== 'string' || !/^[a-f0-9]{64}$/.test(file.hash)) throw new Error('Invalid managed artifact')
      if (paths.has(`${String(file.podId)}:${path}`)) throw new Error('Invalid duplicate artifact')
      paths.add(`${String(file.podId)}:${path}`)
      if (centralRevision(file.size) > centralMaxBytes) throw new Error('Managed artifact exceeds limit')
    }
    return
  }
  if (table) {
    if (!Array.isArray(value) || value.length > centralChunkRows || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Invalid workspace archive')
    return
  }
  if (kind === 'pod') {
    const pod = centralObject(value) as PodPart
    if (pod.id !== podId || typeof pod.ready !== 'boolean') throw new Error('Invalid Pod snapshot binding')
    parsePodDetails(pod.details); parseScriptView(pod.scripts); parseScheduleView(pod.scheduling)
    if (parseResourceState(pod.resources).resources.some(resource => resource.podId !== podId)) throw new Error('Invalid resource Pod binding')
    if (pod.scripts.pod.id !== podId) throw new Error('Script belongs to another Pod')
    const runs = centralObject(pod.runs)
    if (!Array.isArray(runs.runIds) || runs.runIds.length > 100 || new Set(runs.runIds).size !== runs.runIds.length) throw new Error('Invalid run view collections')
    runs.runIds.forEach(centralId)
    parseRunView({ ...runs, runs: [], events: [] })
    return
  }
  if (kind === 'version') { if (parseScriptView(value).pod.id !== podId) throw new Error('Script belongs to another Pod'); return }
  if (kind === 'run') { if (parseRunView({ runs: [value], events: [] }).runs[0]!.podId !== podId || (value as RunRecord).id !== id) throw new Error('Invalid run Pod binding'); return }
  parseRunView({ runs: [], events: value })
}

// Cross-part rules: every Pod listed has a part, nothing references unknown Pods,
// and every run a Pod lists exists with its events.
export function validateManifest(keys: string[], read: (key: string) => unknown): void {
  const present = new Set(keys)
  for (const key of ['workspace', 'artifacts', 'schema']) {
    if (!present.has(key)) throw new Error('Invalid workspace inventory')
  }
  const pods = new Set((read('workspace') as WorkspaceState).pods.map(pod => pod.id))
  for (const key of keys) {
    const { podId, kind } = parsePartKey(key)
    if (podId && !pods.has(podId)) throw new Error('Invalid Pod snapshot binding')
    if (kind === 'events' && !present.has(key.replace('/events/', '/run/'))) throw new Error('Invalid history Pod binding')
  }
  for (const podId of pods) {
    if (!present.has(`pod/${podId}`)) throw new Error('Invalid workspace inventory')
    for (const runId of (read(`pod/${podId}`) as PodPart).runs.runIds) {
      if (!present.has(`pod/${podId}/run/${runId}`) || !present.has(`pod/${podId}/events/${runId}`)) throw new Error('Invalid history Pod binding')
    }
  }
  for (const file of read('artifacts') as CentralSnapshot['artifacts']) {
    if (!pods.has(file.podId)) throw new Error('Invalid managed artifact')
  }
}
