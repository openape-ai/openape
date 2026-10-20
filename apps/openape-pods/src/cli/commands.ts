import { readFile, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { CliClient } from './client'
import { UsageError } from './arguments'
import type { CliArguments } from './arguments'
import { parseWorkspace } from '../contracts/control'
import type { StoredPod } from '../contracts/control'
import { parseRunView } from '../contracts/runs'
import type { RunRecord } from '../contracts/runs'
import { parseScriptView } from '../contracts/scripts'

export interface CliIO {
  output: (value: unknown) => void
  progress: (value: unknown) => void
  ask?: (question: string) => Promise<string>
  signal: AbortSignal
}

async function workspace(client: CliClient) { return parseWorkspace(await client.request({ channel: 'workspace', command: { type: 'list' } })) }
function selectPod(pods: StoredPod[], id: string): StoredPod {
  const matches = pods.filter(pod => pod.id === id || (id.length >= 8 && pod.id.startsWith(id)))
  if (matches.length !== 1) throw new UsageError(matches.length ? 'Pod ID is ambiguous; use the full ID' : 'Pod not found; use ape-pods list')
  return matches[0]!
}

async function importScript(client: CliClient, podId: string, path: string): Promise<void> {
  if ((await stat(path)).size > 256 * 1024) throw new UsageError('Script exceeds 256 KiB')
  const code = await readFile(path, 'utf8')
  let view = parseScriptView(await client.request({ channel: 'scripts', command: { type: 'list', podId } }))
  const expectedActive = view.pod.activeScript
  view = parseScriptView(await client.request({ channel: 'scripts', command: { type: 'save', podId, revision: view.pod.revision, draftId: null, draftRevision: 0, code, capabilities: view.source?.capabilities ?? [], ...(view.source?.packages ? { packages: view.source.packages } : {}) } }))
  if (!view.source || view.source.kind !== 'draft') throw new Error('The script was not saved as a draft')
  const draftId = view.source.id
  if (Object.keys(view.source.packages?.dependencies ?? {}).length) {
    view = parseScriptView(await client.request({ channel: 'scripts', command: { type: 'prepareDependencies', podId, revision: view.pod.revision, draftId, draftRevision: view.source.revision } }))
  }
  if (!view.source) throw new Error('Draft source is unavailable')
  view = parseScriptView(await client.request({ channel: 'scripts', command: { type: 'validate', podId, revision: view.pod.revision, draftId, draftRevision: view.source.revision } }))
  if (!view.source?.validated || !view.source.hash) throw new Error(`Script validation failed; previous active script is unchanged (Pod ${podId})`)
  await client.request({ channel: 'scripts', command: { type: 'activate', podId, revision: view.pod.revision, hash: view.source.hash, expectedActive } })
}

async function runPod(client: CliClient, pod: StoredPod, io: CliIO): Promise<number> {
  if (io.signal.aborted) return 130
  if (!pod.activeScript) throw new UsageError('Pod has no active validated script')
  const result = await client.request({ channel: 'runs', command: { type: 'start', podId: pod.id, expectedScript: pod.activeScript } }) as { runId: string }
  if (!result || typeof result.runId !== 'string') throw new Error('Runtime did not return a run ID; inspect history before retrying')
  const runId = result.runId
  io.progress({ podId: pod.id, runId, state: 'started' })
  let after = 0; let cancelled = false
  for (;;) {
    const view = parseRunView(await client.request({ channel: 'runs', command: { type: 'list', podId: pod.id, runId, after } }))
    for (const event of view.events) { io.progress({ podId: pod.id, runId, ...event }); after = event.sequence }
    const run = view.runs.find(item => item.id === runId)
    if (!run) throw new Error(`Run ${runId} is missing; inspect before retrying`)
    if (run.state !== 'running') {
      if (view.events.length) continue
      io.output(run)
      return cancelled || run.state === 'cancelled' ? 130 : ['completed', 'completedWithGaps'].includes(run.state) ? 0 : 1
    }
    if (io.signal.aborted && !cancelled) {
      cancelled = true
      try {
        await client.request({ channel: 'runs', command: { type: 'cancel', podId: pod.id, runId } })
      }
      catch (error) {
        const latest = parseRunView(await client.request({ channel: 'runs', command: { type: 'list', podId: pod.id, runId, after } }))
        if (!latest.runs.some(item => item.id === runId && item.state !== 'running')) throw error
      }
      continue
    }
    await delay(250)
  }
}

export async function executeCli(args: CliArguments, client: CliClient, io: CliIO): Promise<number> {
  if (args.command === 'agent-backends') {
    const type = args.id === 'reload' ? 'reloadProxy' : args.id === 'disable' ? 'disableProxy' : 'proxyStatus'
    io.output(await client.request({ channel: 'agentBackends', command: { type } }))
    return 0
  }
  let state = await workspace(client)
  if (args.command === 'list') {
    const pods: (StoredPod & { tags: string[], lastRun: Pick<RunRecord, 'id' | 'state' | 'startedAt'> | null })[] = []
    for (const pod of state.pods) {
      const last = parseRunView(await client.request({ channel: 'runs', command: { type: 'list', podId: pod.id } })).runs[0]
      pods.push({ ...pod, tags: state.tags?.find(item => item.id === pod.id)?.tags ?? [], lastRun: last ? { id: last.id, state: last.state, startedAt: last.startedAt } : null })
    }
    io.output({ pods }); return 0
  }
  let pod: StoredPod
  if (args.command === 'create') {
    const name = args.name ?? (io.ask ? await io.ask('Pod name: ') : '')
    if (!name.trim()) throw new UsageError('create requires --name outside a terminal')
    const before = new Set(state.pods.map(item => item.id))
    state = parseWorkspace(await client.request({ channel: 'workspace', command: { type: 'create', name } }))
    const created = state.pods.filter(item => !before.has(item.id))
    if (created.length !== 1) throw new Error('Create result is uncertain; inspect ape-pods list before retrying')
    pod = created[0]!
    io.progress({ podId: pod.id, state: 'created' })
  }
  else {
    let id = args.id
    if (!id && io.ask) {
      io.progress(state.pods.map(item => ({ id: item.id, name: item.name })))
      id = await io.ask('Pod ID: ')
    }
    if (!id) throw new UsageError('edit requires a Pod ID outside a terminal')
    pod = selectPod(state.pods, id)
  }
  if (args.command === 'run') return runPod(client, pod, io)
  if (args.command === 'edit' && args.name === undefined && args.tags === undefined && args.lifecycle === undefined && !args.script) {
    if (!io.ask) throw new UsageError('edit requires --name, --tags, --lifecycle or --script outside a terminal')
    args = { ...args, name: (await io.ask(`Name [${pod.name}]: `)) || pod.name }
    const tags = await io.ask('Tags (comma separated, blank keeps current, - clears): ')
    if (tags) args.tags = tags === '-' ? [] : tags.split(',').map(tag => tag.trim()).filter(Boolean)
  }
  if (args.command === 'edit' && (args.name !== undefined || args.lifecycle !== undefined)) {
    state = parseWorkspace(await client.request({ channel: 'workspace', command: { type: 'update', id: pod.id, revision: pod.revision, name: args.name ?? pod.name, lifecycle: args.lifecycle ?? pod.lifecycle } }))
    pod = selectPod(state.pods, pod.id)
  }
  if (args.tags !== undefined) {
    const revision = state.tags?.find(item => item.id === pod.id)?.revision ?? 0
    state = parseWorkspace(await client.request({ channel: 'workspace', command: { type: 'tag', id: pod.id, revision, tags: args.tags } }))
  }
  if (args.script) await importScript(client, pod.id, args.script)
  state = await workspace(client)
  io.output({ ...selectPod(state.pods, pod.id), tags: state.tags?.find(item => item.id === pod.id)?.tags ?? [] })
  return 0
}
