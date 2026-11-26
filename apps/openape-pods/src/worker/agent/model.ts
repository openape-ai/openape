import type { AgentGatewayServices } from './gateway'

const modelSlug = /^[\w.:-]{1,128}$/

export function parseModelSlug(value: unknown): string {
  if (typeof value !== 'string' || !modelSlug.test(value)) throw new Error('The model connection returned an invalid model name')
  return value
}

/** Reads the connected account's default model from a model connection endpoint (`{ model }`). */
export function endpointModel(url: string, capability?: string): NonNullable<AgentGatewayServices['model']> {
  return async (signal) => {
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(capability ? { Authorization: `Bearer ${capability}` } : {}) }, body: '{}', signal })
    const reply = await response.json() as { model?: unknown, error?: unknown }
    if (!response.ok) throw new Error(typeof reply.error === 'string' ? reply.error : `The model connection failed (${response.status})`)
    return parseModelSlug(reply.model)
  }
}
