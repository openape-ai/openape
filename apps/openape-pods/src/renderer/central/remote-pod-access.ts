import { reactive, shallowRef } from 'vue'
import type { CentralClient, CentralCommand, CentralRuntime, CentralSummary } from '../../contracts/central'
import { parseCentralCommand } from '../../contracts/central'
import { parseWorkspace } from '../../contracts/control'
import { parsePodDetails } from '../../contracts/details'
import { parseResourceState } from '../../contracts/resources'
import { parseRunView } from '../../contracts/runs'
import { parseScheduleView } from '../../contracts/scheduling'
import { parseScriptView } from '../../contracts/scripts'
import { parseDataView } from '../../contracts/data'
import type { PodAccess } from '../pod-access'
import { WorkspaceRequestError } from './client'

export function remotePodAccess(client: CentralClient, host: () => CentralRuntime, initial: CentralSummary, signal: AbortSignal) {
  const summary = shallowRef(initial)
  const state = reactive({ busy: false, operation: '', error: '' })
  const edits = reactive(new Map<string, () => boolean>())
  const podId = initial.pod.id
  let refreshing: Promise<CentralSummary> | null = null
  async function refresh() {
    if (refreshing) return refreshing
    refreshing = client.read(host().id, podId)
    try { const value = await refreshing; summary.value = value; return value }
    finally { refreshing = null }
  }
  function checkPod(body: Record<string, unknown>) {
    if (body.podId !== undefined && body.podId !== podId) throw new Error('Invalid Pod binding')
  }
  async function settle(id: string) {
    let operation = await client.operation(id)
    while (['accepted', 'started'].includes(operation.state)) {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return }
        let timer: ReturnType<typeof setTimeout>
        const cancelled = () => { clearTimeout(timer); reject(signal.reason) }
        timer = setTimeout(() => { signal.removeEventListener('abort', cancelled); resolve() }, 500)
        signal.addEventListener('abort', cancelled, { once: true })
      })
      operation = await client.operation(id)
    }
    return operation
  }
  async function command(channel: CentralCommand['channel'], body: Record<string, unknown>) {
    checkPod(body)
    const request = parseCentralCommand({ channel, body })
    if (state.busy || state.operation) throw new Error('Review the pending operation before making another change.')
    if (!host().online || !host().workspace.pods.find(pod => pod.id === podId)?.online) throw new Error('This Pod is offline.')
    state.busy = true; state.error = ''; state.operation = crypto.randomUUID()
    try {
      let result = await client.command(host().id, summary.value.revision, request, state.operation)
      if (['accepted', 'started'].includes(result.state)) result = await settle(state.operation)
      if (result.state === 'failed') { state.operation = ''; throw new Error(result.error ?? 'The command failed.') }
      if (result.state !== 'applied') throw new Error(result.error ?? 'The command could not be confirmed. Inspect its outcome before retrying.')
      state.operation = ''
      if (channel !== 'data') await refresh()
      return result.result
    }
    catch (error) {
      if (error instanceof WorkspaceRequestError && error.status >= 400 && error.status < 500) state.operation = ''
      state.error = error instanceof Error ? error.message : String(error)
      throw error
    }
    finally { state.busy = false }
  }
  async function reconcile() {
    if (!state.operation || state.busy) return
    state.busy = true
    try {
      const result = await client.operation(state.operation)
      if (result.state === 'applied' || result.state === 'failed') {
        state.operation = ''; state.error = result.state === 'failed' ? result.error ?? 'The command failed.' : ''
        await refresh()
      }
      else {
        state.error = `Operation ${result.id}: ${result.state}. No command was repeated.`
      }
    }
    catch (error) { state.error = error instanceof Error ? error.message : String(error) }
    finally { state.busy = false }
  }
  const access: PodAccess = {
    remote: true, key: id => `${host().id}:${id}`, edits,
    api: {
      workspace: async body => body.type === 'list' ? host().workspace : parseWorkspace(await command('workspace', body)),
      details: async (body) => { checkPod(body); return body.type === 'list' ? summary.value.pod.details : parsePodDetails(await command('details', body)) },
      scripts: async (body) => {
        checkPod(body)
        if (body.type !== 'list') return parseScriptView(await command('scripts', body))
        if (body.selection) return (await client.version(host().id, podId, body.selection.id)).version
        return summary.value.pod.scripts
      },
      resources: async (body) => { checkPod(body); return body.type === 'list' ? summary.value.pod.resources : parseResourceState(await command('resources', body)) },
      scheduling: async (body) => { checkPod(body); return body.type === 'list' ? summary.value.pod.scheduling : parseScheduleView(await command('scheduling', body)) },
      runs: async (body) => {
        checkPod(body)
        if (body.type !== 'list') return parseRunView(await command('runs', body))
        const runs = [...summary.value.pod.runs.runs]
        while (runs.length < summary.value.total) {
          const page = await client.runs(host().id, podId, runs.length)
          if (!page.runs.length) break
          runs.push(...page.runs)
        }
        const runId = body.runId ?? runs[0]?.id
        const detail = runId ? await client.run(host().id, podId, runId) : null
        return { ...summary.value.pod.runs, runs, events: detail?.events ?? [] }
      },
      data: async body => parseDataView(await command('data', body)),
      workflows: async (body) => {
        if (body.type !== 'list') throw new Error('Manage workflows on the desktop.')
        return host().workflows ?? { workflows: [], runs: [] }
      },
    },
  }
  return { access, state, summary, reconcile, update(value: CentralSummary) { summary.value = value } }
}
