import type { IncomingMessage, Server } from 'node:http'
import type { ChatCompletionsRequest } from './types'
import { createServer } from 'node:http'
import { postCodexResponses } from './codex-client'
import { fetchCodexModels } from './codex-models'
import { CodexCredentialStore } from './credential-store'
import { collectChatCompletion, streamChatCompletion } from './proxy'

export interface CodexProxyOptions {
  /** Where the Codex credential (auth.json) lives; the Troop "Connect ChatGPT" flow seeds it. */
  credentialPath: string
  /** `originator` header value. Defaults to "openape". */
  originator?: string
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      }
      catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    req.on('error', reject)
  })
}

/**
 * A thin OpenAI-compatible proxy: `POST /v1/chat/completions` → Codex Responses,
 * streamed back as `chat.completion.chunk`s. Starts immediately (no device-login
 * block — the litellm failure this replaces); a request fails with a clear 502
 * until a credential is seeded at `credentialPath`.
 */
export function createCodexProxyServer(opts: CodexProxyOptions): Server {
  const store = new CodexCredentialStore(opts.credentialPath)
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      try {
        const cred = await store.get()
        const created = Math.floor(Date.now() / 1000)
        const data = (await fetchCodexModels(cred)).map(id => ({ id, object: 'model', created, owned_by: 'openai' }))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data }))
      }
      catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message } }))
      }
      return
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"not found"}}')
      return
    }
    try {
      const body = await readJson(req) as ChatCompletionsRequest
      const cred = await store.get()
      const created = Math.floor(Date.now() / 1000)
      const meta = { id: `chatcmpl-${created}`, model: body.model, created }
      const chunks = streamChatCompletion(body, {
        meta,
        fetchResponses: b => postCodexResponses(b, cred, opts.originator),
      })

      // `stream:true` → SSE; anything else (incl. omitted) → a single
      // `chat.completion` JSON, the OpenAI default that zaz/agent-runtime expect.
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'connection': 'keep-alive' })
        for await (const chunk of chunks)
          res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }
      else {
        const completion = await collectChatCompletion(chunks, meta)
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(completion))
      }
    }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!res.headersSent)
        res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message } }))
    }
  })
}
