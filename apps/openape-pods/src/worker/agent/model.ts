import { readFile } from 'node:fs/promises'
import type { AgentRuntime } from './executor'
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

/**
 * Resolves the account default for one model run. The bundled Codex needs the model's catalog entry; a default
 * it does not know means this Pods build is older than the account's model, and another model must not be chosen.
 */
export async function assignedModel(runtime: AgentRuntime, model: AgentGatewayServices['model'], signal: AbortSignal, resolved?: (model: string) => void): Promise<string> {
  if (!model) throw new Error('Connect Codex before running the model')
  const slug = parseModelSlug(await model(signal))
  signal.throwIfAborted()
  resolved?.(slug)
  const catalog = JSON.parse(await readFile(runtime.catalog, 'utf8')) as { models?: { slug?: unknown }[] }
  if (!Array.isArray(catalog.models) || !catalog.models.some(entry => entry.slug === slug)) throw new Error(`The default model of the connected ChatGPT account (${slug}) is not in the bundled Codex model catalog. Update OpenApe Pods to a version whose bundled Codex supports this model.`)
  return slug
}
