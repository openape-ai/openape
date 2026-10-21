import { createHash } from 'node:crypto'
import { AgentCallError, safeSystemCause } from '../../contracts/agent-errors'
import { apiHeaders, httpError, readBody } from './transport'
import type { ModelApiConnection, ModelCatalog, ModelCatalogEntry } from './types'

export async function readModelCatalog(connection: ModelApiConnection, key: string | undefined, signal: AbortSignal, fetcher: typeof fetch): Promise<ModelCatalog> {
  const entries = new Map<string, ModelCatalogEntry>(); const pages: unknown[] = []; const cursors = new Set<string>()
  let cursor: string | undefined
  try {
    for (let page = 0; page < 10; page++) {
      signal.throwIfAborted()
      const url = new URL(`${connection.baseUrl}/models`)
      if (cursor) url.searchParams.set('after_id', cursor)
      const response = await fetcher(url.toString(), { headers: apiHeaders(connection.format, connection.authentication, key), signal, redirect: 'manual' })
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new AgentCallError('proxy_unreachable', 'Catalog redirects are not permitted', { phase: 'resolve', httpStatus: response.status }) }
      let value: unknown
      try { value = await readBody(response, signal) }
      catch (error) { if (!response.ok) throw httpError(response.status, undefined, response.headers.get('retry-after')); throw error }
      if (!response.ok) throw httpError(response.status, value, response.headers.get('retry-after'))
      if (!value || typeof value !== 'object' || !('data' in value) || !Array.isArray(value.data)) throw new AgentCallError('invalid_response', 'The API does not supply a model catalog', { phase: 'resolve' })
      const raw = value as Record<string, unknown>; pages.push(value)
      for (const item of value.data) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-z0-9][\w.:@+-]{0,159}$/i.test(item.id) || (item.owned_by !== undefined && typeof item.owned_by !== 'string')) throw new AgentCallError('invalid_response', 'Model catalog entry is invalid', { phase: 'resolve' })
        const entry: ModelCatalogEntry = { id: item.id, ...(item.owned_by ? { owned_by: item.owned_by } : {}), ...(item.max_tokens !== undefined ? { max_tokens: item.max_tokens } : {}) }
        if (entries.has(entry.id) && JSON.stringify(entries.get(entry.id)) !== JSON.stringify(entry)) throw new AgentCallError('invalid_response', 'Model catalog has conflicting identities', { phase: 'resolve' })
        entries.set(entry.id, entry)
        if (entries.size > 2000) throw new AgentCallError('response_too_large', 'Model catalog exceeds its entry limit', { phase: 'resolve' })
      }
      if (raw.has_more !== undefined && typeof raw.has_more !== 'boolean') throw new AgentCallError('invalid_response', 'Model catalog pagination is invalid', { phase: 'resolve' })
      if (raw.has_more !== true && raw.next_page == null && raw.next_cursor == null) return { entries: [...entries.values()], checkedAt: new Date().toISOString(), hash: createHash('sha256').update(JSON.stringify(pages)).digest('hex') }
      if (connection.format !== 'messages' || raw.has_more !== true || typeof raw.last_id !== 'string' || !entries.has(raw.last_id) || cursors.has(raw.last_id)) throw new AgentCallError('invalid_response', 'Model catalog pagination is unsupported or incomplete', { phase: 'resolve' })
      cursor = raw.last_id; cursors.add(cursor)
    }
    throw new AgentCallError('response_too_large', 'Model catalog exceeds its page limit', { phase: 'resolve' })
  }
  catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof AgentCallError) throw new AgentCallError(error.code, error.message, { ...error.details, phase: 'resolve' })
    throw new AgentCallError('proxy_unreachable', 'Model catalog connection failed', { phase: 'resolve', cause: safeSystemCause(error) })
  }
}
