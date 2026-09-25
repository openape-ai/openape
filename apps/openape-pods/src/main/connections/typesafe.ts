import { setTimeout as delay } from 'node:timers/promises'
import { parseJevModel, parseJevResult, parseTypesafeKey, typesafeOrigin } from '../../contracts/jev'
import type { JevEvaluation, JevRequest } from '../../contracts/jev'

const maxResponseBytes = 128 * 1024
const attemptTimeoutMs = 30000
const evaluationTimeoutMs = 60000

export class TypesafeError extends Error {
  constructor(readonly status: number) { super(status === 401 || status === 403 ? 'TypeSafe API key is invalid or access was denied; reconnect' : `TypeSafe request failed (HTTP ${status})`) }
}
export async function typesafeJSON(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('TypeSafe returned an empty response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxResponseBytes) throw new Error('TypeSafe response exceeds 128 KiB')
      chunks.push(value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
    catch { throw new Error('TypeSafe returned invalid JSON') }
  }
  finally { await reader.cancel() }
}
export async function verifyTypesafe(key: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${typesafeOrigin}/v1/models`, { headers: { Authorization: `Bearer ${parseTypesafeKey(key)}` }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]) })
  if (!response.ok) { await response.body?.cancel(); throw new TypesafeError(response.status) }
  const value = await typesafeJSON(response) as { models?: { name?: unknown }[] } | null
  if (!value || !Array.isArray(value.models) || !value.models.some(model => typeof model?.name === 'string' && model.name.startsWith('jev-'))) throw new Error('No Jev model is available for this TypeSafe connection')
}
function retryDelay(header: string | null, attempt: number): number {
  if (header !== null) {
    const seconds = Number(header)
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
    if (Number.isFinite(milliseconds)) return Math.min(evaluationTimeoutMs, Math.max(0, milliseconds))
  }
  return 500 * 2 ** (attempt - 1)
}
export async function evaluateTypesafe(request: JevRequest, model: string, signal: AbortSignal, send: (body: string, signal: AbortSignal) => Promise<Response>, consumeAttempt: () => void): Promise<JevEvaluation> {
  parseJevModel(model)
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(evaluationTimeoutMs)])
  for (let attempt = 1; attempt <= 3; attempt++) {
    bounded.throwIfAborted(); consumeAttempt()
    let response: Response
    try { response = await send(JSON.stringify({ ...request, model }), AbortSignal.any([bounded, AbortSignal.timeout(attemptTimeoutMs)])) }
    catch (error) {
      bounded.throwIfAborted()
      if (!(error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError'))) throw error
      if (attempt === 3) throw new Error('TypeSafe network request failed after three attempts')
      await delay(retryDelay(null, attempt), undefined, { signal: bounded }); continue
    }
    if (response.ok) {
      const result = parseJevResult(await typesafeJSON(response), request, model)
      bounded.throwIfAborted()
      return { result, attempts: attempt }
    }
    const wait = retryDelay(response.headers.get('retry-after'), attempt)
    await response.body?.cancel()
    if (![429, 529, 502, 503, 504].includes(response.status) || attempt === 3) throw new TypesafeError(response.status)
    await delay(wait, undefined, { signal: bounded })
  }
  throw new Error('TypeSafe evaluation exhausted its retry limit')
}
