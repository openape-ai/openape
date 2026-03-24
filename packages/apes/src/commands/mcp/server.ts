import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { createServer } from 'node:http'
import consola from 'consola'
import { registerAdapterTools, registerStaticTools } from './tools'

declare const __VERSION__: string

export async function startMcpServer(transport: 'stdio' | 'sse', port: number) {
  const server = new McpServer({
    name: 'apes',
    version: typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.1.0',
  })

  // Register static tools
  registerStaticTools(server)

  // Register adapter-derived tools
  registerAdapterTools(server)

  if (transport === 'stdio') {
    const stdioTransport = new StdioServerTransport()
    await server.connect(stdioTransport)
  }
  else if (transport === 'sse') {
    const httpServer = createServer(async (req, res) => {
      if (req.url === '/sse' && req.method === 'GET') {
        const sseTransport = new SSEServerTransport('/messages', res)
        await server.connect(sseTransport)
      }
      else if (req.url === '/messages' && req.method === 'POST') {
        // SSE message handling is done by the transport
        res.writeHead(200)
        res.end()
      }
      else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    httpServer.listen(port, () => {
      consola.info(`MCP SSE server listening on http://localhost:${port}/sse`)
    })
  }
}
