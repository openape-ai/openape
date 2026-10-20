import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { AgentCallError, safeSystemCause } from '../../contracts/agent-errors'
import { configurationHash, parseAgentBackendConfig } from './config'
import { readPrivateJson } from './private-file'

export async function disableProxyConfiguration(path: string, expectedHash: string): Promise<void> {
  const config = parseAgentBackendConfig(await readPrivateJson(path, 'configuration'))
  if (configurationHash(config) !== expectedHash) throw new AgentCallError('proxy_not_configured', 'Proxy configuration changed; reload before disabling it', { phase: 'resolve', cause: 'configuration_changed' })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    try {
      await writeFile(temporary, `${JSON.stringify({ ...config, proxy: { ...config.proxy, enabled: false } }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      const current = parseAgentBackendConfig(await readPrivateJson(path, 'configuration'))
      if (configurationHash(current) !== expectedHash) throw new AgentCallError('proxy_not_configured', 'Proxy configuration changed; reload before disabling it', { phase: 'resolve', cause: 'configuration_changed' })
      await rename(temporary, path)
    }
    finally { await rm(temporary, { force: true }) }
  }
  catch (error) {
    if (error instanceof AgentCallError) throw error
    throw new AgentCallError('proxy_not_configured', 'Proxy configuration could not be disabled', { phase: 'resolve', cause: safeSystemCause(error) })
  }
}
