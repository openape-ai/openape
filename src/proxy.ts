import { createHash } from 'node:crypto'
import type { ProxyConfig, AuditEntry } from './types.js'
import { evaluateRules } from './matcher.js'
import { verifyAgentAuth } from './auth.js'
import { GrantsClient } from './grants-client.js'
import { writeAudit } from './audit.js'

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

export function createProxy(config: ProxyConfig) {
  const grantsClient = new GrantsClient(config.proxy.idp_url)

  return {
    port: parseInt(config.proxy.listen.split(':')[1] || '9090'),
    hostname: config.proxy.listen.split(':')[0] || '127.0.0.1',

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const startTime = Date.now()

      // Health endpoint
      if (url.pathname === '/healthz') {
        return Response.json({ status: 'ok', agent: config.proxy.agent_email })
      }

      // Parse target URL from the path.
      // The agent sends: http://proxy:9090/https://api.github.com/repos/x/issues
      // So the target URL is everything after the first /
      const targetUrl = url.pathname.slice(1) + url.search
      let targetParsed: URL
      try {
        targetParsed = new URL(targetUrl)
      } catch {
        return new Response(
          'Invalid target URL. Send requests as: http://proxy:port/https://target.com/path',
          { status: 400 },
        )
      }

      const domain = targetParsed.hostname
      const method = req.method
      const path = targetParsed.pathname

      // Read body once (needed for hash + forwarding)
      const bodyBuffer = req.body ? await req.arrayBuffer() : null

      // Verify agent identity
      const agent = await verifyAgentAuth(
        req.headers.get('proxy-authorization'),
        config.proxy.idp_url,
      )

      const agentEmail = agent?.email ?? config.proxy.agent_email

      // Evaluate rules
      const action = evaluateRules(config, domain, method, path)

      const baseAudit: Omit<AuditEntry, 'action' | 'rule'> = {
        ts: new Date().toISOString(),
        agent: agentEmail,
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
        agentEmail,
        domain,
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
          requester: agentEmail,
          target: domain,
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
          requester: agentEmail,
          target: domain,
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

      } catch (err) {
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
      // @ts-expect-error Bun supports duplex
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
