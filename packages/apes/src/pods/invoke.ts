export interface ToolReply {
  exitCode?: number
  stdout?: string
  stderr?: string
  pending?: { grantId: string, approvalUrl: string }
  refusal?: { state: string, reason?: string }
}
export interface Tools {
  invoke: (request: Record<string, unknown>) => Promise<ToolReply>
  withdraw: (request: { reference: string, reason: string }) => Promise<unknown>
}
export class StageFailure extends Error {
  constructor(readonly status: string, readonly phase: string, cause: string, readonly terminal = false) {
    super(`${phase}: ${redact(cause)}`)
  }
}

export function redact(value: string): string {
  return value.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:token|secret|password|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[redacted JWT]')
    .slice(0, 3500)
}

export async function invoke(tools: Tools, application: string, argv: string[]): Promise<string> {
  const phase = `${application} ${argv[0]}`
  let reply: ToolReply
  try { reply = await tools.invoke({ application, argv, approvalWaitMs: 0 }) }
  catch (error) { throw new StageFailure('unknown', phase, String(error)) }
  if (reply.pending || reply.refusal) throw new StageFailure('blocked', phase, JSON.stringify(reply.pending ?? reply.refusal))
  if (reply.exitCode !== 0) {
    let detail: { state?: string, phase?: string, reason?: string } = {}
    try { detail = JSON.parse(reply.stdout ?? '{}') as typeof detail }
    catch { detail = {} }
    if (!detail || typeof detail !== 'object') detail = {}
    const state = detail.state ?? 'failed'
    if (reply.exitCode === 3 && state === 'dispatching' && reply.stdout) return reply.stdout
    throw new StageFailure(state === 'interrupted' ? 'failed' : state, detail.phase ?? phase,      detail.reason ?? reply.stderr ?? 'Command failed without an error description', ['failed', 'interrupted'].includes(state))
  }
  if (typeof reply.stdout !== 'string') throw new StageFailure('unknown', phase, 'Command returned no stdout')
  return reply.stdout
}

export async function invokeJSON<T>(tools: Tools, application: string, argv: string[]): Promise<T> {
  return JSON.parse(await invoke(tools, application, argv)) as T
}
