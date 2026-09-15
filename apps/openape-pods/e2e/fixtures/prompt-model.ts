import { recordedResponse } from './responses'

export const setupPrompt = 'Create a pod called Greeting in the Examples group. Store the ordinary variable greeting as Hello from my pod. Prepare an interval of 15 minutes but leave automation disabled. The script should write greeting.txt in its workspace and keep a durable run counter. Validate it, fix any errors and run it once manually. Also request an optional notification_token secret for later use, without reading it.'
export const setupAnswer = 'The script and settings are prepared. A manual run was requested; automation remains disabled. The optional notification_token can be added in Settings. Validation used synthetic services.'

function result(body: unknown, callId: string): Record<string, unknown> {
  const input = (body as { input?: { type: string, call_id?: string, output?: unknown }[] }).input
  const output = input?.find(item => item.type === 'function_call_output' && item.call_id === callId)?.output
  const text = typeof output === 'string' ? output : Array.isArray(output) ? output.map(part => (part as { text?: string }).text ?? '').join('') : undefined
  if (!text) throw new Error(`Missing synthetic tool result: ${callId}`)
  return JSON.parse(text) as Record<string, unknown>
}

export class PromptModel {
  calls = 0
  readonly results = new Map<number, Record<string, unknown>>()
  readonly requests: unknown[] = []

  reply(body: unknown): Response {
    if (JSON.stringify(body).includes('previousDescription')) return recordedResponse({ type: 'message', id: 'description', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ description: 'Writes a greeting file and preserves a run counter. The 15-minute schedule is prepared and remains disabled.' }), annotations: [] }] })
    this.requests.push(body)
    const index = this.calls++
    if (index) this.results.set(index - 1, result(body, `setup-${index - 1}`))
    const pod = this.results.get(1); const inspected = this.results.get(2)
    const scope = { podId: pod?.id, revision: pod?.revision }
    const draft = this.results.get(6); const repaired = this.results.get(8)
    const code = this.results.get(0)?.example as string
    const actions = [
      () => ({ action: 'runtime' }),
      () => ({ action: 'create', name: 'Greeting' }),
      () => ({ action: 'inspect', ...scope }),
      () => ({ action: 'setVariable', ...scope, name: 'greeting', value: 'Hello from my pod', variableRevision: 0 }),
      () => ({ action: 'prepareSchedule', ...scope, scheduleRevision: 0, spec: { kind: 'interval', seconds: 900 } }),
      () => ({ action: 'setGroup', ...scope, name: 'Examples', organizationRevision: (inspected?.organization as { revision: number })?.revision }),
      () => ({ action: 'draft', ...scope, draftId: null, draftRevision: 0, code: code.replace('expectedRevision:context.input.checkpointRevision', 'expectedRevision:-1'), capabilities: [] }),
      () => ({ action: 'validate', ...scope, draftId: draft?.draftId, draftRevision: draft?.draftRevision }),
      () => {
        if (!String(this.results.get(7)?.error).includes('Invalid checkpoint fields')) throw new Error('The synthetic model did not receive the expected repair feedback')
        return { action: 'draft', ...scope, draftId: draft?.draftId, draftRevision: draft?.draftRevision, code, capabilities: [] }
      },
      () => ({ action: 'validate', ...scope, draftId: repaired?.draftId, draftRevision: repaired?.draftRevision }),
      () => ({ action: 'activate', ...scope, draftId: repaired?.draftId, draftRevision: repaired?.draftRevision }),
      () => ({ action: 'run', ...scope }),
      () => ({ action: 'requestAccess', ...scope, request: { provider: 'credential', alias: 'notification_token', description: 'Optional notification secret for later use. Enter its value only in Settings.' } }),
      () => ({ action: 'inspect', ...scope }),
    ]
    const action = actions[index]
    if (!action) return recordedResponse({ type: 'message', id: 'setup-answer', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: setupAnswer, annotations: [] }] })
    return recordedResponse({ type: 'function_call', id: `setup-item-${index}`, call_id: `setup-${index}`, name: 'pods_control', arguments: JSON.stringify(action()) })
  }
}
