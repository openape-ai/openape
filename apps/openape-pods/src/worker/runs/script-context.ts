import type { RunInput } from '../../contracts/runs'

type Request = (operation: string, payload: unknown) => Promise<unknown>
export interface ScriptModule { run?: (context: unknown) => Promise<unknown>, contract?: unknown, work?: unknown, polls?: unknown }

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
/**
 * The frozen `context` a Pod script receives; every service is a request to the dispatcher: private progress, notifications and generic program execution. Tests build the same context in-process.
 */
export async function scriptContext(script: ScriptModule, input: RunInput, request: Request, log: (message: string) => void, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (script.contract !== undefined || script.work !== undefined || script.polls !== undefined) throw new Error('Shared datastore and work declarations are retired; use files or an external service')
  return Object.freeze({
    timing: () => request('run.timing', {}),
    jev: Object.freeze({ evaluate: (payload: unknown) => request('jev.evaluate', payload) }),
    variables: Object.freeze(input.variables ?? {}),
    aliases: freeze(input.aliases ?? { applications: {}, http: {}, directories: {}, references: {} }),
    input,
    home: input.home ?? process.env.HOME,
    directories: Object.freeze((input.directories ?? []).map(item => Object.freeze(item))),
    workspace: input.workspace,
    references: input.references,
    signal,
    http: Object.freeze({ request: (payload: unknown) => request('http.request', payload) }),
    credentials: Object.freeze({ get: (alias: string) => request('credentials.get', { alias }) }),
    tools: Object.freeze({ invoke: (payload: unknown) => request('tools.invoke', payload), withdraw: (payload: unknown) => request('tools.withdraw', payload) }),
    agent: Object.freeze({ run: (payload: unknown) => request('agent.run', payload) }),
    progress: Object.freeze({ commit: (payload: unknown) => request('progress.commit', payload) }),
    notify: (payload: unknown) => request('notify', payload),
    log,
  })
}
export { freeze }
