// A tiny OpenAI-compatible mock LLM for the local agent-lifecycle test.
//
// It exists so the local nest's agents have an LLM endpoint WITHOUT a ChatGPT
// subscription holder — a second codex-proxy on a live account hard-terminates
// the first (the "one holder per account" rule), so a mock is the only safe
// choice here. For a spawn/run/destroy test the response content is irrelevant;
// deterministic + free + zero-subscription is exactly what a test harness wants.
//
// Serves: GET /health, GET /v1/models, POST /v1/chat/completions (streaming and
// non-streaming). The reply echoes the last user message so an agent's run is
// traceable in logs/screenshots.

import { createServer } from 'node:http'

const PORT = Number(process.env.PORT || 4000)
const MODELS = (process.env.MOCK_MODELS || 'gpt-5.5,gpt-5.4').split(',').map(s => s.trim()).filter(Boolean)

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => resolve(raw))
  })
}

function replyText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const lastUser = [...messages].reverse().find(m => m?.role === 'user')
  const snippet = String(lastUser?.content ?? '').slice(0, 140)
  return `[mock-llm] ok — handled: ${snippet || '(no user message)'}`
}

const server = createServer(async (req, res) => {
  const url = req.url || ''
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }

  if (req.method === 'GET' && (url === '/health' || url === '/'))
    return json(200, { status: 'ok' })

  if (req.method === 'GET' && url.startsWith('/v1/models'))
    return json(200, { object: 'list', data: MODELS.map(id => ({ id, object: 'model', owned_by: 'mock-llm' })) })

  if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
    const body = JSON.parse((await readBody(req)) || '{}')
    const text = replyText(body)
    const model = body.model || MODELS[0]
    const id = 'chatcmpl-mock'

    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' })
      const send = (delta, finish) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      send({ role: 'assistant' }, null)
      send({ content: text }, null)
      send({}, 'stop')
      res.write('data: [DONE]\n\n')
      return res.end()
    }

    return json(200, {
      id,
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  }

  json(404, { error: { message: `mock-llm: no route for ${req.method} ${url}` } })
})

server.listen(PORT, '0.0.0.0', () => console.log(`[mock-llm] listening on :${PORT} (models: ${MODELS.join(', ')})`))
