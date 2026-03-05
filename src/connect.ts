import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { connect } from 'node:net'
import type { MultiAgentProxyConfig } from './types.js'
import { AuthError, verifyAgentAuth } from './auth.js'
import { isPrivateOrLoopback } from './ssrf.js'
import { writeAudit } from './audit.js'

/**
 * Handle HTTP CONNECT requests for tunneling (used by HTTP_PROXY clients).
 * Flow: Auth check → SSRF check → TCP connect → bidirectional pipe.
 */
export async function handleConnect(
  config: MultiAgentProxyConfig,
  req: IncomingMessage,
  clientSocket: Socket,
  _head: Buffer,
): Promise<void> {
  const target = req.url ?? ''
  const [host, portStr] = target.split(':')
  const port = Number.parseInt(portStr || '443')

  if (!host || !port) {
    clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    clientSocket.destroy()
    return
  }

  const mandatoryAuth = config.proxy.mandatory_auth ?? false

  // Auth check — CONNECT always requires auth in mandatory mode
  let agentEmail: string | undefined
  try {
    const authHeader = req.headers['proxy-authorization'] as string | undefined
    let identity: { email: string, act: 'agent' } | null = null

    for (const agentConf of config.agents) {
      identity = await verifyAgentAuth(
        authHeader ?? null,
        agentConf.idp_url,
        mandatoryAuth && config.agents.length === 1,
      )
      if (identity) break
    }

    if (mandatoryAuth && !identity) {
      throw new AuthError('JWT required')
    }

    agentEmail = identity?.email

    // Verify agent is known
    if (agentEmail) {
      const known = config.agents.find(a => a.email === agentEmail)
      if (!known) {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        clientSocket.destroy()
        return
      }
    }
    else if (config.agents.length > 1) {
      throw new AuthError('JWT required for multi-agent proxy')
    }
  }
  catch (err) {
    if (err instanceof AuthError) {
      clientSocket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      clientSocket.destroy()
      return
    }
    throw err
  }

  // SSRF check
  if (await isPrivateOrLoopback(host)) {
    writeAudit({
      ts: new Date().toISOString(),
      agent: agentEmail ?? config.agents[0]?.email ?? 'unknown',
      action: 'deny',
      domain: host,
      method: 'CONNECT',
      path: target,
      rule: 'ssrf-blocked',
    })
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    clientSocket.destroy()
    return
  }

  // Connect to target
  const targetSocket = connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

    // Bidirectional pipe
    targetSocket.pipe(clientSocket)
    clientSocket.pipe(targetSocket)
  })

  targetSocket.on('error', () => {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    clientSocket.destroy()
  })

  clientSocket.on('error', () => {
    targetSocket.destroy()
  })

  // Cleanup on close
  clientSocket.on('close', () => targetSocket.destroy())
  targetSocket.on('close', () => clientSocket.destroy())
}
