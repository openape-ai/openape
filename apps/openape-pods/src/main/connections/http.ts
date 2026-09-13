export async function readJSON(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Connection service rejected the request (${response.status})`)
  if (!response.body) throw new Error('Connection service returned no response')
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break
      size += next.value.byteLength
      if (size > 128 * 1024) throw new Error('Connection response exceeds its limit')
      chunks.push(next.value)
    }
  }
  finally {
    try { await reader.cancel() }
    finally { reader.releaseLock() }
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString())
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid connection response')
  return value as Record<string, unknown>
}
export async function connectionRequest(issuer: string, path: string, body: unknown, signal: AbortSignal, bearer?: string): Promise<Record<string, unknown>> {
  return readJSON(await fetch(`${issuer}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) }))
}
