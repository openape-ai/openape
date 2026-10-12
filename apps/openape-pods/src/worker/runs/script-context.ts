import type { RunInput } from '../../contracts/runs'

type Request = (operation: string, payload: unknown) => Promise<unknown>
export interface ScriptModule { run?: (context: unknown) => Promise<unknown>, contract?: unknown, work?: unknown }

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
const options = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

/**
 * The frozen `context` a Pod script receives; every service is a request to the dispatcher (issue 1465 adds shared data,
 * work, owner questions, approvals and the approved mail archive). Tests build the same context in-process.
 */
export async function scriptContext(script: ScriptModule, input: RunInput, request: Request, log: (message: string) => void, signal: AbortSignal): Promise<Record<string, unknown>> {
  const items = script.contract === undefined ? [] : await request('graph.contract', script.contract)
  if (script.work !== undefined) await request('work.contract', script.work)
  const data = input.network
    ? Object.freeze({ get: (payload: unknown) => request('data.get', payload), put: (payload: unknown) => request('data.put', payload), delete: (payload: unknown) => request('data.delete', payload), query: (payload: unknown) => request('data.query', payload) })
    : Object.freeze({ get: (key: unknown) => request('data.get', { key }), set: (key: unknown, value: unknown, settings?: unknown) => request('data.set', { ...options(settings), key, value }), delete: (key: unknown, settings?: unknown) => request('data.delete', { ...options(settings), key }), list: (prefix: unknown, settings?: unknown) => request('data.list', { ...options(settings), prefix }) })
  const work = Object.freeze({ find: (query: unknown) => request('work.find', query ?? {}), claim: (query: unknown) => request('work.claim', query), complete: (query: unknown) => request('work.complete', query), defer: (query: unknown) => request('work.defer', query), fail: (query: unknown) => request('work.fail', query) })
  return Object.freeze({
    config: freeze(input.config ?? {}), data, work,
    decisions: Object.freeze({ ask: (question: unknown) => request('decisions.ask', question) }),
    approvals: Object.freeze({ request: (approval: unknown) => request('approvals.request', approval), get: (id: unknown) => request('approvals.get', { id }) }),
    artifacts: input.network ? Object.freeze({ create: (payload: unknown) => request('artifacts.create', payload), read: (payload: unknown) => request('artifacts.read', payload) }) : undefined,
    network: input.network ? Object.freeze({ info: input.network, gateCoverage: () => request('network.gateCoverage', {}), choices: (query?: unknown) => request('network.choices', query ?? {}), emit: (payload: unknown) => request('network.emit', payload), archive: (target: unknown) => request('network.archive', target) }) : undefined,
    items: freeze(items), emit: async (channel: string, item: object) => { await request('graph.emit', { ...item, channel }) },
    jev: Object.freeze({ evaluate: (payload: unknown) => request('jev.evaluate', payload) }),
    variables: Object.freeze(input.variables ?? {}), aliases: freeze(input.aliases ?? { applications: {}, http: {}, directories: {}, references: {} }), input,
    home: input.home ?? process.env.HOME, directories: Object.freeze((input.directories ?? []).map(item => Object.freeze(item))), workspace: input.workspace, references: input.references, signal,
    http: Object.freeze({ request: (payload: unknown) => request('http.request', payload) }),
    credentials: Object.freeze({ get: (alias: string) => request('credentials.get', { alias }) }),
    mail: Object.freeze({ archiveApproved: (target: unknown) => request('mail.archiveApproved', target), archive: Object.freeze({ prepare: (proposal: unknown) => request('mail.archive', { operation: 'prepare', proposal }), process: (target?: unknown) => request('mail.archive', target === undefined ? { operation: 'process' } : { operation: 'process', target }) }), next: () => request('mail.next', {}), commit: (payload: unknown) => request('mail.commit', payload) }),
    tools: Object.freeze({ invoke: (payload: unknown) => request('tools.invoke', payload) }),
    agent: Object.freeze({ run: (payload: unknown) => request('agent.run', payload) }),
    progress: Object.freeze({ commit: (payload: unknown) => request('progress.commit', payload) }),
    notify: (payload: unknown) => request('notify', payload), log,
  })
}
export { freeze }
