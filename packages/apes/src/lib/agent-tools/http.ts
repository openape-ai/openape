import type { ToolDefinition } from './index'

const MAX_BYTES = 1024 * 1024
// Headers we never let the model set: hop-by-hop ones, host (we
// don't want to spoof another origin) and authorization (the model
// would otherwise be a step away from "fetch tasks.openape.ai with my
// own JWT" — that's a manual escalation path, not a tool the agent
// gets out of the box).
const FORBIDDEN_HEADERS = new Set([
  'host',
  'authorization',
  'cookie',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
])

function sanitizeHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v !== 'string') continue
    if (FORBIDDEN_HEADERS.has(k.toLowerCase())) continue
    out[k] = v
  }
  return out
}

async function readCappedBody(res: Response): Promise<string> {
  const buf = new Uint8Array(MAX_BYTES + 1)
  let written = 0
  const reader = res.body?.getReader()
  if (!reader) return await res.text()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (written + value.byteLength > MAX_BYTES) {
      buf.set(value.subarray(0, MAX_BYTES - written), written)
      written = MAX_BYTES
      try { await reader.cancel() }
      catch { /* ignore */ }
      break
    }
    buf.set(value, written)
    written += value.byteLength
  }
  return new TextDecoder().decode(buf.subarray(0, written))
}

export const httpTools: ToolDefinition[] = [
  {
    name: 'http.get',
    description: 'GET an HTTPS URL and return the response body (capped at 1MB). Useful for reading public APIs, RSS feeds, web pages.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute HTTPS URL.' },
        headers: { type: 'object', description: 'Optional headers (Host, Authorization, Cookie are stripped).' },
      },
      required: ['url'],
    },
    execute: async (args: unknown) => {
      const a = args as { url: string, headers?: unknown }
      if (typeof a.url !== 'string' || !a.url.startsWith('http')) {
        throw new Error('url must be an http(s) URL')
      }
      const res = await fetch(a.url, { method: 'GET', headers: sanitizeHeaders(a.headers) })
      const body = await readCappedBody(res)
      return { status: res.status, headers: Object.fromEntries(res.headers), body }
    },
  },
  {
    name: 'http.post',
    description: 'POST JSON to an HTTPS URL and return the response body (capped at 1MB).',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute HTTPS URL.' },
        body: { description: 'JSON-serialisable payload.' },
        headers: { type: 'object', description: 'Optional headers (Host, Authorization, Cookie are stripped).' },
      },
      required: ['url', 'body'],
    },
    execute: async (args: unknown) => {
      const a = args as { url: string, body: unknown, headers?: unknown }
      if (typeof a.url !== 'string' || !a.url.startsWith('http')) {
        throw new Error('url must be an http(s) URL')
      }
      const res = await fetch(a.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...sanitizeHeaders(a.headers) },
        body: JSON.stringify(a.body),
      })
      const body = await readCappedBody(res)
      return { status: res.status, headers: Object.fromEntries(res.headers), body }
    },
  },
]
