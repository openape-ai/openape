import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { connect } from 'node:net'
import type { AgentConfig, MultiAgentProxyConfig, ProxyConfig } from './types.js'
import { AuthError, verifyAgentAuth } from './auth.js'
import { checkEgress } from './ssrf.js'
import { writeAudit } from './audit.js'
import { evaluateRules } from './matcher.js'
import type { GrantsClient } from './grants-client.js'

/**
 * Handle HTTP CONNECT requests for tunneling (used by HTTP_PROXY clients).
 * Flow: Auth → SSRF → host-based rule evaluation (allow / deny / grant_required)
 *  → TCP connect → bidirectional pipe.
 *
 * For HTTPS via CONNECT we only see the hostname (the TLS payload is opaque).
 * Rules with `methods` or `path` filters cannot be enforced at CONNECT time and
 * are skipped — they'd only match if the client also carried the same hostname
 * over cleartext-HTTP forward-proxy. This is intentional: there's no honest way
 * to gate a method we can't observe.
 */
export async function handleConnect(
  config: MultiAgentProxyConfig,
  grantsClients: Map<string, GrantsClient>,
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

  // SYSTEM BYPASS: outbound to any configured IdP host is unconditionally
  // allowed. The proxy itself talks to the IdP for JWT verification + grant
  // approval, and any process inside the proxy boundary may need to call the
  // IdP for `apes login` / `apes whoami` / token-exchange BEFORE it can ever
  // produce a valid Proxy-Authorization JWT. Blocking IdP traffic would
  // either deadlock the grant flow or lock users out of authentication.
  // We therefore skip auth (no JWT yet for first-login), SSRF (local-dev IdPs
  // can live at 127.0.0.1), and policy rules (operator must not be able to
  // override this system invariant).
  const idpHosts = new Set(
    config.agents
      .map((a) => {
        try {
          return new URL(a.idp_url).hostname.toLowerCase()
        }
        catch {
          return ''
        }
      })
      .filter(h => h.length > 0),
  )
  if (idpHosts.has(host.toLowerCase())) {
    writeAudit({
      ts: new Date().toISOString(),
      agent: 'system',
      action: 'allow',
      domain: host,
      method: 'CONNECT',
      path: target,
      rule: 'idp-system-bypass',
    })
    tunnel(host, port, clientSocket)
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

  // SSRF / reachability check. We split the two outcomes:
  //   - `private`        → policy refusal, 403 (the proxy will not forward).
  //   - `unresolvable`   → upstream not reachable, 502 (DNS NXDOMAIN /
  //     NODATA / query error — distinct from "I refuse on policy grounds";
  //     conflating them shipped misleading 403s for typos like
  //     `apes proxy -- curl https://example.at`).
  const egress = await checkEgress(host)
  const auditAgent = agentEmail ?? config.agents[0]?.email ?? 'unknown'
  if (egress.kind === 'private') {
    writeAudit({
      ts: new Date().toISOString(),
      agent: auditAgent,
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
  if (egress.kind === 'unresolvable') {
    writeAudit({
      ts: new Date().toISOString(),
      agent: auditAgent,
      action: 'error',
      domain: host,
      method: 'CONNECT',
      path: target,
      rule: `dns-unresolvable (${egress.reason})`,
    })
    clientSocket.write(
      `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nDNS lookup failed for ${host} (${egress.reason}).\r\n`,
    )
    clientSocket.destroy()
    return
  }

  // Host-based rule evaluation. Pick the agent's config: in single-agent or
  // unauth mode this is just config.agents[0]; in multi-agent mode we use the
  // identity established above.
  const agentConf: AgentConfig | undefined = agentEmail
    ? config.agents.find(a => a.email === agentEmail)
    : config.agents[0]
  if (!agentConf) {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    clientSocket.destroy()
    return
  }
  const effectiveEmail = agentEmail ?? agentConf.email

  const rulesConfig: ProxyConfig = {
    proxy: {
      listen: config.proxy.listen,
      idp_url: agentConf.idp_url,
      agent_email: agentConf.email,
      default_action: config.proxy.default_action,
    },
    allow: agentConf.allow ?? [],
    deny: agentConf.deny ?? [],
    grant_required: agentConf.grant_required ?? [],
  }

  // CONNECT carries no method/path beyond host:port. Pass 'CONNECT' as method
  // and '/' as path so rules with method-filters (which we can't enforce here)
  // simply don't match — operator must specify method-less rules to gate
  // HTTPS hosts.
  const action = evaluateRules(rulesConfig, host, 'CONNECT', '/')
  const baseAudit = {
    ts: new Date().toISOString(),
    agent: effectiveEmail,
    domain: host,
    method: 'CONNECT',
    path: target,
  } as const

  if (action.type === 'deny') {
    writeAudit({ ...baseAudit, action: 'deny', rule: 'deny-list' })
    const note = action.note ? ` ${action.note}` : ''
    clientSocket.write(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nBlocked:${note}\r\n`)
    clientSocket.destroy()
    return
  }

  if (action.type === 'grant_required') {
    const grantsClient = grantsClients.get(agentConf.email)
    if (!grantsClient) {
      writeAudit({ ...baseAudit, action: 'deny', rule: 'grant_required (no client)' })
      clientSocket.write('HTTP/1.1 500 Internal Server Error\r\n\r\nNo grants client for agent\r\n')
      clientSocket.destroy()
      return
    }

    // Async-mode (`request-async`) is meaningful for HTTP forward-proxy where
    // the client can re-issue the request after approval. CONNECT clients
    // (curl, gh, …) won't transparently retry on 407 mid-handshake, so we
    // always block the tunnel until the grant resolves. Operator can shorten
    // the wait via per-rule `duration` or via the IdP's grant TTL.
    const startTs = Date.now()
    try {
      const grant = await grantsClient.requestGrant({
        requester: effectiveEmail,
        targetHost: host,
        audience: 'ape-proxy',
        grantType: action.rule.grant_type,
        permissions: action.rule.permissions,
        reason: `CONNECT ${host}:${port}`,
        duration: action.rule.duration,
      })
      const decided = await grantsClient.waitForApproval(grant.id)
      const waitedMs = Date.now() - startTs
      if (decided.status === 'approved') {
        writeAudit({ ...baseAudit, action: 'grant_approved', rule: 'grant_required', grant_id: decided.id, waited_ms: waitedMs })
        // Fall through to the TCP connect below.
      }
      else {
        writeAudit({ ...baseAudit, action: 'grant_denied', rule: 'grant_required', grant_id: decided.id, waited_ms: waitedMs })
        clientSocket.write(`HTTP/1.1 403 Forbidden\r\n\r\nGrant denied by ${decided.decided_by ?? 'policy'}\r\n`)
        clientSocket.destroy()
        return
      }
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      writeAudit({ ...baseAudit, action: 'grant_timeout', rule: 'grant_required', error: msg })
      clientSocket.write(`HTTP/1.1 504 Gateway Timeout\r\n\r\nGrant request failed: ${msg}\r\n`)
      clientSocket.destroy()
      return
    }
  }
  else {
    // 'allow' — log and continue.
    writeAudit({ ...baseAudit, action: 'allow', rule: 'allow-list' })
  }

  tunnel(host, port, clientSocket)
}

/**
 * Open a TCP socket to host:port and bidirectionally pipe it with the client
 * socket. Used by both the policy-pass path (auth + rules approved) and the
 * IdP system-bypass path (no auth/policy involved).
 */
function tunnel(host: string, port: number, clientSocket: Socket): void {
  const targetSocket = connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
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

  clientSocket.on('close', () => targetSocket.destroy())
  targetSocket.on('close', () => clientSocket.destroy())
}
