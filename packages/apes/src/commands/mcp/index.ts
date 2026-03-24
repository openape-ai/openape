import { defineCommand } from 'citty'

export const mcpCommand = defineCommand({
  meta: {
    name: 'mcp',
    description: 'Start MCP server for AI agents',
  },
  args: {
    transport: {
      type: 'string',
      description: 'Transport type: stdio or sse',
      default: 'stdio',
    },
    port: {
      type: 'string',
      description: 'Port for SSE transport',
      default: '3001',
    },
  },
  async run({ args }) {
    const transport = (args.transport || 'stdio') as 'stdio' | 'sse'
    const port = Number.parseInt(String(args.port), 10)

    if (transport !== 'stdio' && transport !== 'sse') {
      throw new Error('Transport must be "stdio" or "sse"')
    }

    const { startMcpServer } = await import('./server.js')
    await startMcpServer(transport, port)
  },
})
