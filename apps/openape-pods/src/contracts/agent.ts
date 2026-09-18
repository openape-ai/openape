export interface AgentRequest { prompt: string, tools: [] | ['ape_shell'] }

export function parseAgentRequest(value: unknown): AgentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['prompt', 'tools'].includes(key))) throw new Error('Invalid agent request')
  const request = value as { prompt?: unknown, tools?: unknown }
  if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 128 * 1024) throw new Error('Invalid agent prompt')
  if (request.tools === undefined) return { prompt: request.prompt, tools: [] }
  if (!Array.isArray(request.tools) || request.tools.length > 1 || request.tools.some(tool => tool !== 'ape_shell')) throw new Error('Agent tools must be [] or ["ape_shell"]')
  return { prompt: request.prompt, tools: request.tools.length ? ['ape_shell'] : [] }
}
