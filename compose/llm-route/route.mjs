// Path-selector shim for the llms.openape.ai LLM gateway (M3 multi-account).
//
// Stock LiteLLM only matches /v1/... and routes purely by the body `model`
// name. To support per-account base_urls like
//   https://llms.openape.ai/<owner>/<account>/v1/chat/completions
// this shim strips the /<owner>/<account> prefix, prefixes the body model with
// the account (so LiteLLM picks the account's deployment), and forwards the
// account+owner as headers for the custom_auth policy. The Authorization bearer
// is passed through untouched — LiteLLM's custom_auth still validates it.
//
// Only account-paths reach this shim (the edge routes plain /v1 straight to
// LiteLLM), so the default fleet traffic is byte-stable and never depends on it.

import { createServer, request as httpRequest } from 'node:http'
import process from 'node:process'

const PORT = Number(process.env.PORT || 4020)
const UPSTREAM = new URL(process.env.LITELLM_URL || 'http://litellm:4000')
const DEFAULT_ACCOUNT = process.env.DEFAULT_ACCOUNT || 'lindeverlag'
const MAX_BODY = 5_000_000

// /<owner>/<account>/v1/<rest> — owner must look like an email so we never
// mistake a plain /v1/<x>/<y> path for an account selector.
const ACCOUNT_PATH = /^\/(?<owner>[^/]+)\/(?<account>[^/]+)(?<rest>\/v1\/.+)$/s
const SAFE = /^[a-z0-9._@+-]+$/
const REWRITABLE = /\/v1\/(?:chat\/completions|completions|embeddings|responses)/

// Returns { account, owner, path, prefixModel } from a request url. owner is
// null for the default (non-account) path. Throws on a malformed selector.
export function route(url) {
  const m = ACCOUNT_PATH.exec(url)
  if (!m) return { account: DEFAULT_ACCOUNT, owner: null, path: url, prefixModel: false }
  const owner = decodeURIComponent(m.groups.owner).toLowerCase()
  if (!owner.includes('@')) return { account: DEFAULT_ACCOUNT, owner: null, path: url, prefixModel: false }
  const account = decodeURIComponent(m.groups.account).toLowerCase()
  if (!SAFE.test(owner) || !SAFE.test(account)) throw new Error('bad owner/account')
  return { account, owner, path: m.groups.rest, prefixModel: account !== DEFAULT_ACCOUNT }
}

// Prefix the body's model with the account (gpt-5.5 -> delta-mind/gpt-5.5) so
// LiteLLM routes to the account deployment. No-op if already namespaced.
export function rewriteBody(buf, account, path) {
  if (!buf.length || !REWRITABLE.test(path)) return buf
  let j
  try { j = JSON.parse(buf.toString('utf8')) }
  catch { return buf }
  if (typeof j.model === 'string' && !j.model.includes('/')) {
    j.model = `${account}/${j.model}`
    return Buffer.from(JSON.stringify(j))
  }
  return buf
}

function handle(req, res) {
  let r
  try { r = route(req.url || '/') }
  catch { res.writeHead(400); return res.end('bad owner/account') }

  const chunks = []
  let size = 0
  req.on('data', (c) => {
    size += c.length
    if (size > MAX_BODY) { req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => {
    let body = Buffer.concat(chunks)
    const headers = { ...req.headers, host: UPSTREAM.host }
    if (r.owner) {
      headers['x-openape-owner'] = r.owner
      headers['x-openape-account'] = r.account
    }
    if (r.prefixModel) {
      body = rewriteBody(body, r.account, r.path)
      headers['content-length'] = Buffer.byteLength(body)
    }
    const upReq = httpRequest(
      { hostname: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path: r.path, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers)
        upRes.pipe(res)
      },
    )
    upReq.on('error', (e) => { res.writeHead(502); res.end(`upstream error: ${e.message}`) })
    upReq.end(body)
  })
}

if (process.env.NODE_ENV !== 'test') {
  createServer(handle).listen(PORT, '0.0.0.0', () => console.log(`llm-route on :${PORT} -> ${UPSTREAM.href} (default account=${DEFAULT_ACCOUNT})`))
}
