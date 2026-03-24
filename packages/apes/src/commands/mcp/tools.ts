import { hostname } from 'node:os'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createShapesGrant,
  fetchGrantToken,
  loadAdapter,
  resolveCommand,
  verifyAndExecute,
} from '@openape/shapes'
import { z } from 'zod'
import { getAuthToken, getIdpUrl, getRequesterIdentity } from '../../config'
import { apiFetch, getGrantsEndpoint } from '../../http'
import { loadAdapterTools } from './adapter-tools'

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
    description: 'Show what permissions a command would need',
    inputSchema: {
      command: z.array(z.string()).describe('Command as array of strings (e.g. ["gh", "repo", "list"])'),
      adapter: z.string().optional().describe('Explicit adapter TOML path'),
    },
  }, async ({ command, adapter }) => {
    try {
      const loaded = loadAdapter(command[0]!, adapter)
      const resolved = await resolveCommand(loaded, command)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            adapter: resolved.adapter.cli.id,
            operation: resolved.detail.operation_id,
            display: resolved.detail.display,
            permission: resolved.permission,
            resource_chain: resolved.detail.resource_chain,
            exact_command: resolved.detail.constraints?.exact_command ?? false,
            adapter_digest: resolved.digest,
          }, null, 2),
        }],
      }
    }
    catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
    }
  })

  server.registerTool('apes.adapter.list', {
    description: 'List installed CLI adapters',
  }, () => {
    const tools = loadAdapterTools()
    const adapters = [...new Set(tools.map(t => t.adapterId))]
    return {
      content: [{
        type: 'text' as const,
        text: adapters.length > 0
          ? `Installed adapters: ${adapters.join(', ')}`
          : 'No adapters installed.',
      }],
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

export function registerAdapterTools(server: McpServer) {
  const adapterTools = loadAdapterTools()

  for (const tool of adapterTools) {
    // Build Zod schema from adapter operation
    const schemaShape: Record<string, z.ZodType> = {
      grant_id: z.string().optional().describe('Grant ID from a previous pending_approval response'),
    }

    if (tool.inputSchema && typeof tool.inputSchema === 'object') {
      const props = (tool.inputSchema as { properties?: Record<string, { description?: string }> }).properties
      if (props) {
        for (const [key, val] of Object.entries(props)) {
          schemaShape[key] = z.string().optional().describe(val.description || key)
        }
      }
    }

    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: schemaShape,
    }, async (args) => {
      const idp = getIdpUrl()
      if (!idp)
        return { content: [{ type: 'text' as const, text: 'Not configured. Run `apes login` first.' }], isError: true }

      try {
        const loaded = loadAdapter(tool.adapterId)
        const op = loaded.adapter.operations.find(o => o.id === tool.operationId)
        if (!op)
          return { content: [{ type: 'text' as const, text: `Operation ${tool.operationId} not found` }], isError: true }

        const argv = [loaded.adapter.cli.executable, ...op.command]
        if (op.positionals) {
          for (const pos of op.positionals) {
            if (args[pos])
              argv.push(String(args[pos]))
          }
        }
        if (op.required_options) {
          for (const opt of op.required_options) {
            const name = opt.replace(/^--/, '')
            if (args[name])
              argv.push(opt, String(args[name]))
          }
        }

        const resolved = await resolveCommand(loaded, argv)

        if (args.grant_id) {
          const token = await fetchGrantToken(idp, String(args.grant_id))
          await verifyAndExecute(token, resolved)
          return { content: [{ type: 'text' as const, text: 'Command executed successfully.' }] }
        }

        const grant = await createShapesGrant(resolved, { idp, approval: 'once' })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'pending_approval',
              grant_id: grant.id,
              approve_url: `${idp}/grant-approval?grant_id=${grant.id}`,
              message: 'Grant needs approval. Approve, then call this tool again with grant_id.',
            }, null, 2),
          }],
        }
      }
      catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
      }
    })
  }
}
