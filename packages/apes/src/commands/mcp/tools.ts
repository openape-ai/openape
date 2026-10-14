import { hostname } from 'node:os'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getAuthToken, getIdpUrl, getRequesterIdentity } from '../../config'
import { apiFetch, getGrantsEndpoint } from '../../http'
import { authorizeProgramCall, locateProgram } from '../../authorization/program'
import { captureProgramCall } from '../../authorization/execute'
import { describePreview, listShapes, previewCommand } from '../../authorization/shapes'
import { shellTargetHost } from '../../shell/context'

export function registerStaticTools(server: McpServer) {
  server.registerTool('apes.grants.list', {
    description: 'List grants',
    inputSchema: {
      status: z.string().optional().describe('Filter by status: pending, approved, denied, revoked, used'),
      limit: z.string().optional().describe('Max results'),
    },
  }, async ({ status, limit }) => {
    const idp = getIdpUrl()
    if (!idp)
      return { content: [{ type: 'text' as const, text: 'Not configured. Run `apes login` first.' }] }

    const grantsUrl = await getGrantsEndpoint(idp)
    const params = new URLSearchParams()
    if (status)
      params.set('status', status)
    if (limit)
      params.set('limit', limit)
    const query = params.toString() ? `?${params.toString()}` : ''
    const response = await apiFetch(`${grantsUrl}${query}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] }
  })

  server.registerTool('apes.grants.request', {
    description: 'Request a grant for a command',
    inputSchema: {
      command: z.string().describe('Command to request permission for'),
      audience: z.string().describe('Service identifier (e.g. escapes, proxy, shapes)'),
      approval: z.string().optional().describe('once, timed, or always'),
      reason: z.string().optional().describe('Reason for the request'),
    },
  }, async ({ command, audience, approval, reason }) => {
    const idp = getIdpUrl()
    const requester = getRequesterIdentity()
    if (!idp || !requester)
      return { content: [{ type: 'text' as const, text: 'Not authenticated. Run `apes login` first.' }] }

    const grantsUrl = await getGrantsEndpoint(idp)
    const cmdParts = command.split(' ')
    const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
      method: 'POST',
      body: {
        requester,
        target_host: hostname(),
        audience,
        grant_type: approval || 'once',
        command: cmdParts,
        reason: reason || command,
      },
    })

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'pending_approval',
          grant_id: grant.id,
          approve_url: `${idp}/grant-approval?grant_id=${grant.id}`,
          message: 'Grant needs approval. Approve via URL or `apes grants approve <id>`, then retry with grant_id.',
        }, null, 2),
      }],
    }
  })

  server.registerTool('apes.config.get', {
    description: 'Get apes configuration value',
    inputSchema: {
      key: z.string().describe('Config key: idp, email'),
    },
  }, ({ key }) => {
    if (key === 'idp') {
      const idp = getIdpUrl()
      return { content: [{ type: 'text' as const, text: idp || 'Not configured' }] }
    }
    if (key === 'email') {
      const email = getRequesterIdentity()
      return { content: [{ type: 'text' as const, text: email || 'Not logged in' }] }
    }
    return { content: [{ type: 'text' as const, text: `Unknown key: ${key}` }] }
  })

  server.registerTool('apes.explain', {
    description: 'Preview how the IdP resolves a command (the IdP decides per call)',
    inputSchema: {
      command: z.array(z.string()).describe('Command as array of strings (e.g. ["gh", "repo", "list"])'),
    },
  }, async ({ command }) => {
    const idp = getIdpUrl()
    if (!idp)
      return { content: [{ type: 'text' as const, text: 'Not configured. Run `apes login` first.' }], isError: true }
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(describePreview(await previewCommand(idp, command)), null, 2) }] }
    }
    catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
    }
  })

  server.registerTool('apes.adapter.list', {
    description: 'List the CLI adapters (Shapes) the IdP resolves commands with',
  }, async () => {
    const idp = getIdpUrl()
    if (!idp)
      return { content: [{ type: 'text' as const, text: 'Not configured. Run `apes login` first.' }], isError: true }
    try {
      const shapes = await listShapes(idp)
      return { content: [{ type: 'text' as const, text: shapes.length > 0 ? `IdP adapters: ${shapes.map(shape => shape.cli_id).join(', ')}` : 'The IdP has no adapters.' }] }
    }
    catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
    }
  })

  server.registerTool('apes.fetch', {
    description: 'Make an authenticated HTTP request',
    inputSchema: {
      method: z.string().describe('HTTP method (GET, POST, PUT, DELETE)'),
      url: z.string().describe('URL to fetch'),
      body: z.string().optional().describe('Request body (JSON string)'),
    },
  }, async ({ method, url, body }) => {
    const token = getAuthToken()
    if (!token)
      return { content: [{ type: 'text' as const, text: 'Not authenticated. Run `apes login` first.' }], isError: true }

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body || undefined,
    })
    const text = await response.text()
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(JSON.parse(text), null, 2) }] }
    }
    catch {
      return { content: [{ type: 'text' as const, text }] }
    }
  })
}

/**
 * `apes.run`: one program call, authorized per call at the IdP like `apes run`. A pending request is returned to
 * the caller, who calls again with the same command after approval; nothing runs without a verified token.
 */
export function registerRunTool(server: McpServer) {
  server.registerTool('apes.run', {
    description: 'Run a program call authorized by the IdP (returns pending_approval until the owner approves)',
    inputSchema: {
      command: z.array(z.string()).min(1).describe('Program and arguments, e.g. ["git", "status"]'),
      approval: z.enum(['once', 'always']).optional().describe('Requested grant type, default once'),
    },
  }, async ({ command, approval }) => {
    const idp = getIdpUrl()
    const subject = getRequesterIdentity()
    if (!idp || !subject)
      return { content: [{ type: 'text' as const, text: 'Not authenticated. Run `apes login` first.' }], isError: true }
    try {
      const program = await locateProgram(command[0]!)
      if (!program)
        return { content: [{ type: 'text' as const, text: `${command[0]}: no executable file found` }], isError: true }
      const call = { program, argv: command.slice(1) }
      const authorization = await authorizeProgramCall(call, { idp, subject, targetHost: shellTargetHost(), grantType: approval ?? 'once', wait: false })
      if (authorization.kind === 'pending') {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'pending_approval',
              grant_id: authorization.grantId,
              approve_url: authorization.approvalUrl,
              message: 'Grant needs approval. After approval call this tool again with the same command.',
            }, null, 2),
          }],
        }
      }
      const run = captureProgramCall(call)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ exit_code: run.exitCode, stdout: run.stdout, stderr: run.stderr }, null, 2) }],
        ...(run.exitCode === 0 ? {} : { isError: true }),
      }
    }
    catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
    }
  })
}
