import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { AgentCallError, safeSystemCause } from '../../contracts/agent-errors'

export async function readPrivateJson(path: string, kind: 'configuration' | 'credential', signal?: AbortSignal): Promise<unknown> {
  const code = kind === 'credential' ? 'credential_unavailable' : 'proxy_not_configured'
  const maximum = kind === 'credential' ? 16384 : 65536
  let bytes: Buffer | undefined
  try {
    signal?.throwIfAborted()
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.nlink !== 1 || stat.size < 1 || stat.size > maximum) throw new AgentCallError(code, `Proxy ${kind} must be a private owner file with one link and bounded size`, { phase: 'resolve' })
      bytes = Buffer.alloc(stat.size + 1)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      const after = await file.stat()
      if (bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.nlink !== 1) throw new AgentCallError(code, `Proxy ${kind} changed while being read`, { phase: 'resolve' })
      signal?.throwIfAborted()
      try { return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')) as unknown }
      catch { throw new AgentCallError(code, `Proxy ${kind} is not valid JSON`, { phase: 'resolve' }) }
    }
    finally { bytes?.fill(0); await file.close() }
  }
  catch (error) {
    if (signal?.aborted) throw signal.reason
    if (error instanceof AgentCallError) throw error
    throw new AgentCallError(code, `Proxy ${kind} could not be read`, { phase: 'resolve', cause: safeSystemCause(error) })
  }
}

export async function readProxyKey(path: string, signal: AbortSignal): Promise<string> {
  const value = await readPrivateJson(path, 'credential', signal)
  const key = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).api_key : undefined
  if (typeof key !== 'string' || !key || key.length > 4096 || /[\s\x7F]/.test(key) || [...key].some(character => character.charCodeAt(0) < 32)) throw new AgentCallError('credential_unavailable', 'Proxy credential requires a nonempty api_key', { phase: 'resolve' })
  return key
}
