import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'

export interface AgentGatewayServices { provider: (body: unknown, signal: AbortSignal) => Promise<Response>, tool: (body: unknown, signal: AbortSignal) => Promise<unknown> }
async function body(request: IncomingMessage): Promise<unknown> {
  let bytes = 0; const chunks: Buffer[] = []
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new Error('Agent request exceeds its limit'); chunks.push(Buffer.from(chunk)) }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown
}
function json(response: ServerResponse, value: unknown): void { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
export async function startAgentGateway(services: AgentGatewayServices, signal: AbortSignal) {
  const capability = randomBytes(32).toString('hex')
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const received = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${capability}`)
    if (received.length !== expected.length || !timingSafeEqual(received, expected) || signal.aborted || request.headers.origin) { response.statusCode = 403; json(response, { error: 'Run capability rejected' }); return }
    if (request.method !== 'POST' || !['/mcp', '/v1/responses'].includes(request.url ?? '')) { response.statusCode = 405; json(response, { error: 'Unsupported agent endpoint' }); return }
    const value = await body(request)
    if (request.url === '/v1/responses') {
      const upstream = await services.provider(value, signal)
      response.statusCode = upstream.status; response.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'text/event-stream')
      if (upstream.body) {
        const reader = upstream.body.getReader()
        try { for (;;) { const next = await reader.read(); if (next.done) break; response.write(next.value) } }
        finally { await reader.cancel(); reader.releaseLock() }
      }
      response.end(); return
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP request')
    const rpc = value as { jsonrpc?: string, id?: string | number, method?: string, params?: { name?: string, arguments?: unknown } }
    if (rpc.jsonrpc !== '2.0') throw new Error('Invalid MCP protocol')
    if (rpc.method === 'notifications/initialized' && rpc.id === undefined) { response.statusCode = 202; response.end(); return }
    if (typeof rpc.id !== 'string' && typeof rpc.id !== 'number') throw new Error('Invalid MCP request identity')
    let result: unknown
    if (rpc.method === 'initialize') {
      result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'OpenApe Pods', version: '1' } }
    }
    else if (rpc.method === 'ping') {
      result = {}
    }
    else if (rpc.method === 'tools/list') {
      result = { tools: [{ name: 'ape_shell', description: 'Invoke one explicitly assigned tool command for this pod.', inputSchema: { type: 'object', properties: { toolId: { type: 'string' }, argv: { type: 'array', items: { type: 'string' } } }, required: ['toolId', 'argv'], additionalProperties: false } }] }
    }
    else if (rpc.method === 'tools/call' && rpc.params?.name === 'ape_shell') {
      try { result = { content: [{ type: 'text', text: JSON.stringify(await services.tool(rpc.params.arguments, signal)) }] } }
      catch (error) { result = { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Assigned tool call failed' }] } }
    }
    else { json(response, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Only the assigned ape-shell tool is available' } }); return }
    json(response, { jsonrpc: '2.0', id: rpc.id, result })
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy()
      }
      else { response.statusCode = 400; json(response, { error: error instanceof Error ? error.message : 'Agent gateway failed' }) }
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Agent gateway failed to bind')
  return { port: address.port, capability, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } }
}
