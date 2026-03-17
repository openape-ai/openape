import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { createHash } from 'node:crypto'
import type { AgentConfig, AuditEntry, MultiAgentProxyConfig, ProxyConfig } from './types.js'
import { evaluateRules } from './matcher.js'
import { AuthError, verifyAgentAuth } from './auth.js'
import { GrantsClient } from './grants-client.js'
import { writeAudit } from './audit.js'
import { isPrivateOrLoopback } from './ssrf.js'
import { handleConnect } from './connect.js'

/**
 * Compute a request hash that uniquely identifies the intent.
 * hash = sha256(METHOD + " " + FULL_URL + "\n" + BODY)
 * This binds the grant to the exact request — no bait-and-switch.
 */
async function computeRequestHash(method: string, targetUrl: string, body: ArrayBuffer | null): Promise<string> {
  const hash = createHash('sha256')
  hash.update(`${method} ${targetUrl}\n`)
  if (body && body.byteLength > 0) {
    hash.update(new Uint8Array(body))
  }
  return hash.digest('hex')
}

/** Legacy single-agent proxy */
export function createProxy(config: ProxyConfig) {
  const multiConfig: MultiAgentProxyConfig = {
    proxy: {
      listen: config.proxy.listen,
      default_action: config.proxy.default_action,
      audit_log: config.proxy.audit_log,
      mandatory_auth: config.proxy.mandatory_auth,
    },
    agents: [{
      email: config.proxy.agent_email,
      idp_url: config.proxy.idp_url,
      allow: config.allow,
      deny: config.deny,
      grant_required: config.grant_required,
    }],
  }
  return createMultiAgentProxy(multiConfig)
}

/** Multi-agent proxy with SSRF protection and mandatory auth */
export function createMultiAgentProxy(config: MultiAgentProxyConfig) {
  const grantsClients = new Map<string, GrantsClient>()
  for (const agent of config.agents) {
    grantsClients.set(agent.email, new GrantsClient(agent.idp_url))
  }

  const mandatoryAuth = config.proxy.mandatory_auth ?? false

  return {
    port: Number.parseInt(config.proxy.listen.split(':')[1] || '9090'),
    hostname: config.proxy.listen.split(':')[0] || '127.0.0.1',

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const startTime = Date.now()

      // Health endpoint
      if (url.pathname === '/healthz') {
        return Response.json({
          status: 'ok',
          agents: config.agents.map(a => a.email),
        })
      }

      // Parse target URL from the path
      const targetUrl = url.pathname.slice(1) + url.search
      let targetParsed: URL
      try {
        targetParsed = new URL(targetUrl)
      }
      catch {
        return new Response(
          'Invalid target URL. Send requests as: http://proxy:port/https://target.com/path',
          { status: 400 },
        )
      }

      const domain = targetParsed.hostname
      const method = req.method
      const path = targetParsed.pathname

      // SSRF protection — block private/loopback IPs before any rule evaluation
      if (await isPrivateOrLoopback(domain)) {
        return new Response('Blocked: private/loopback IP', { status: 403 })
      }

      // Read body once (needed for hash + forwarding)
      const bodyBuffer = req.body ? await req.arrayBuffer() : null

      // Verify agent identity — find IdP URL from first agent (for JWKS verification)
      // In multi-agent mode, we need the JWT to identify the agent first.
      // We try verification against each agent's IdP until one succeeds.
      let agentIdentity: { email: string, act: 'agent' } | null = null
      try {
        for (const agentConf of config.agents) {
          agentIdentity = await verifyAgentAuth(
            req.headers.get('proxy-authorization'),
            agentConf.idp_url,
            mandatoryAuth && config.agents.length === 1,
          )
          if (agentIdentity) break
        }

        // If mandatory auth and no identity found from any IdP
        if (mandatoryAuth && !agentIdentity) {
          throw new AuthError('JWT required')
        }
      }
      catch (err) {
        if (err instanceof AuthError) {
          return new Response(`Unauthorized: ${err.message}`, { status: 401 })
        }
        throw err
      }

      // Find the matching agent config
      const agentEmail = agentIdentity?.email
      let agentConf: AgentConfig | undefined

      if (agentEmail) {
        agentConf = config.agents.find(a => a.email === agentEmail)
        if (!agentConf) {
          return new Response(`Forbidden: unknown agent ${agentEmail}`, { status: 403 })
        }
      }
      else if (config.agents.length === 1) {
        // Non-mandatory auth, single agent: use the only agent config
        agentConf = config.agents[0]
      }
      else {
        return new Response('Unauthorized: JWT required for multi-agent proxy', { status: 401 })
      }

      const effectiveEmail = agentEmail ?? agentConf.email
      const grantsClient = grantsClients.get(agentConf.email)!

      // Build a ProxyConfig-shaped object for evaluateRules
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

      // Evaluate rules
      const action = evaluateRules(rulesConfig, domain, method, path)

      const baseAudit: Omit<AuditEntry, 'action' | 'rule'> = {
        ts: new Date().toISOString(),
        agent: effectiveEmail,
        domain,
        method,
        path,
      }

      // DENY
      if (action.type === 'deny') {
        writeAudit({ ...baseAudit, action: 'deny', rule: 'deny-list', grant_id: null })
        return new Response(`Blocked: ${action.note || 'deny rule'}`, { status: 403 })
      }

      // ALLOW (no grant needed)
      if (action.type === 'allow') {
        writeAudit({ ...baseAudit, action: 'allow', rule: 'allow-list', grant_id: null })
        return forwardRequest(req, targetUrl, bodyBuffer)
      }

      // GRANT REQUIRED
      const rule = action.rule
      const permissions = rule.permissions ?? [`${method.toLowerCase()}:${domain}`]

      // Compute request hash — binds grant to exact method + URL + body
      const requestHash = await computeRequestHash(method, targetUrl, bodyBuffer)

      // Check for existing grant
      const existing = await grantsClient.findExistingGrant(
        effectiveEmail,
        domain,
        'proxy',
        permissions,
      ).catch(() => null)

      if (existing) {
        writeAudit({
          ...baseAudit,
          action: 'grant_approved',
          rule: 'standing-grant',
          grant_id: existing.id,
          request_hash: requestHash,
        })
        return forwardRequest(req, targetUrl, bodyBuffer)
      }

      // No existing grant — behavior depends on default_action
      if (config.proxy.default_action === 'block') {
        writeAudit({ ...baseAudit, action: 'deny', rule: 'no-grant (block mode)', grant_id: null })
        return new Response('No grant — blocked', { status: 403 })
      }

      if (config.proxy.default_action === 'request-async') {
        // Create grant request, return 407 immediately
        const grant = await grantsClient.requestGrant({
          requester: effectiveEmail,
          targetHost: domain,
          audience: 'proxy',
          grantType: rule.grant_type,
          permissions,
          reason: `${method} ${targetUrl}`,
          requestHash,
          duration: rule.duration,
        }).catch(() => null)

        writeAudit({
          ...baseAudit,
          action: 'grant_denied',
          rule: 'grant_required (async)',
          grant_id: grant?.id ?? null,
        })

        return new Response(
          JSON.stringify({
            error: 'Grant required',
            grant_id: grant?.id,
            message: 'Grant request created. Retry after approval.',
          }),
          { status: 407, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // BLOCKING mode: create grant request and wait
      console.error(`[proxy] Requesting grant for ${method} ${domain}${path} — waiting for approval...`)

      try {
        const grant = await grantsClient.requestGrant({
          requester: effectiveEmail,
          targetHost: domain,
          audience: 'proxy',
          grantType: rule.grant_type,
          permissions,
          reason: `${method} ${targetUrl}`,
          requestHash,
          duration: rule.duration,
        })

        const approved = await grantsClient.waitForApproval(grant.id)

        const waitedMs = Date.now() - startTime

        if (approved.status === 'approved') {
          writeAudit({
            ...baseAudit,
            action: 'grant_approved',
            rule: 'grant_required',
            grant_id: approved.id,
            request_hash: requestHash,
            waited_ms: waitedMs,
          })
          return forwardRequest(req, targetUrl, bodyBuffer)
        }

        writeAudit({
          ...baseAudit,
          action: 'grant_denied',
          rule: 'grant_required',
          grant_id: approved.id,
          waited_ms: waitedMs,
        })
        return new Response(`Grant denied by ${approved.decided_by}`, { status: 403 })
      }
      catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        writeAudit({
          ...baseAudit,
          action: 'grant_timeout',
          rule: 'grant_required',
          error: msg,
        })
        return new Response(`Grant request failed: ${msg}`, { status: 504 })
      }
    },
  }
}

/**
 * Create a node:http compatible handler for use with http.createServer().
 * Returns both a request handler and a CONNECT handler.
 */
export function createNodeHandler(config: MultiAgentProxyConfig): {
  handleRequest: (req: IncomingMessage, res: ServerResponse) => void
  handleConnect: (req: IncomingMessage, socket: Socket, head: Buffer) => void
} {
  const proxy = createMultiAgentProxy(config)

  return {
    handleRequest(req: IncomingMessage, res: ServerResponse) {
      // Convert IncomingMessage to Request and use existing fetch logic
      const url = `http://${req.headers.host || 'localhost'}${req.url || '/'}`
      const chunks: Buffer[] = []

      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (value) {
              headers.set(key, Array.isArray(value) ? value.join(', ') : value)
            }
          }

          const request = new Request(url, {
            method: req.method,
            headers,
            body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
            duplex: 'half',
          } as RequestInit)

          const response = await proxy.fetch(request)

          res.writeHead(response.status, response.statusText, Object.fromEntries(response.headers))
          if (response.body) {
            const reader = response.body.getReader()
            const pump = async (): Promise<void> => {
              const { done, value } = await reader.read()
              if (done) {
                res.end()
                return
              }
              res.write(value)
              return pump()
            }
            await pump()
          }
          else {
            res.end()
          }
        }
        catch {
          res.writeHead(502)
          res.end('Proxy error')
        }
      })
    },

    handleConnect(req: IncomingMessage, socket: Socket, head: Buffer) {
      handleConnect(config, req, socket, head)
    },
  }
}

/**
 * Forward a request to the target URL.
 * Strips proxy-specific headers, preserves the rest.
 */
async function forwardRequest(originalReq: Request, targetUrl: string, cachedBody?: ArrayBuffer | null): Promise<Response> {
  const headers = new Headers(originalReq.headers)
  // Remove proxy-specific headers
  headers.delete('proxy-authorization')
  headers.delete('proxy-connection')
  // Don't send host of the proxy
  headers.delete('host')

  const body = cachedBody && cachedBody.byteLength > 0 ? cachedBody : null

  try {
    const res = await fetch(targetUrl, {
      method: originalReq.method,
      headers,
      body,
      duplex: 'half',
      redirect: 'manual',
    })

    // Stream the response back
    const responseHeaders = new Headers(res.headers)
    // Remove hop-by-hop headers
    responseHeaders.delete('transfer-encoding')
    responseHeaders.delete('connection')

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upstream error'
    return new Response(`Proxy error: ${msg}`, { status: 502 })
  }
}
