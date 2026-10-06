import { getAuthorizedBearer } from '@openape/cli-auth'
import { ReportError } from '@openape/report-contracts/html'

export function reportsClient(endpoint: string) {
  let url: URL
  try { url = new URL(endpoint) }
  catch { throw new ReportError('USAGE', 'Invalid Reports endpoint') }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new ReportError('USAGE', 'Use HTTPS or a loopback test endpoint without credentials')
  return async (method: string, path: string, body?: unknown, key?: string, text = false) => {
    let authorization: string
    try { authorization = await getAuthorizedBearer({ endpoint, aud: 'testrun.openape.ai' }) }
    catch (error) { throw new ReportError('AUTHENTICATION', error instanceof Error ? error.message : 'Run apes login <email>', 401) }
    let response: Response
    try {
      response = await fetch(`${endpoint.replace(/\/$/u, '')}${path}`, { method, redirect: 'error', headers: { authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) })
    }
    catch (error) { throw new ReportError('TRANSPORT', `Service unavailable or unknown write outcome. Retain the original key and bytes; use receipt or an identical retry. ${error instanceof Error ? error.message : ''}`, 503) }
    if (!response.ok) {
      const raw = await response.text()
      let failure: { data?: { code?: string, message?: string }, message?: string }
      try { failure = JSON.parse(raw) }
      catch { failure = { message: raw.slice(0, 300) } }
      throw new ReportError(failure.data?.code ?? (response.status === 409 ? 'CONFLICT' : 'SERVICE'), failure.data?.message ?? failure.message ?? `HTTP ${response.status}`, response.status)
    }
    return text ? await response.text() : await response.json()
  }
}
