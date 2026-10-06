export interface AgentRequest { prompt: string, tools: [] | ['ape_shell'], timeoutSeconds: number }
export const defaultAgentTimeoutSeconds = 120
export const maxAgentTimeoutSeconds = 900

export function parseAgentRequest(value: unknown): AgentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['prompt', 'tools', 'timeoutSeconds'].includes(key))) throw new Error('Invalid agent request')
  const request = value as { prompt?: unknown, tools?: unknown, timeoutSeconds?: unknown }
  if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 128 * 1024) throw new Error('Invalid agent prompt')
  const timeoutSeconds = request.timeoutSeconds ?? defaultAgentTimeoutSeconds
  if (!Number.isInteger(timeoutSeconds) || (timeoutSeconds as number) < 30 || (timeoutSeconds as number) > maxAgentTimeoutSeconds) throw new Error(`Agent timeoutSeconds must be an integer from 30 to ${maxAgentTimeoutSeconds}`)
  if (request.tools === undefined) return { prompt: request.prompt, tools: [], timeoutSeconds: timeoutSeconds as number }
  if (!Array.isArray(request.tools) || request.tools.length > 1 || request.tools.some(tool => tool !== 'ape_shell')) throw new Error('Agent tools must be [] or ["ape_shell"]')
  return { prompt: request.prompt, tools: request.tools.length ? ['ape_shell'] : [], timeoutSeconds: timeoutSeconds as number }
}
