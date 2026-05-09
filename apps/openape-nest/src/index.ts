// OpenApe Nest daemon — local control-plane that hosts agents on this
// computer. Listens on 127.0.0.1:9091 (localhost-only, no auth — only
// processes running as the same human user can reach it). Acts as an
// API surface in front of `apes agents spawn|destroy`; bridge-process
// lifecycle is delegated to the per-agent system-domain launchd plists
// `apes agents spawn --bridge` installs into `/Library/LaunchDaemons/`.
// (We previously tried supervising bridges in-daemon — see git history
// for the supervisor — but it duplicated launchd's job, raced the
// system-domain plist, and inherited the human-user PATH which doesn't
// see the agent's `~/.bun/bin/openape-chat-bridge`.)
//
// Bootstrapped by `apes nest install` — see packages/apes/src/commands/
// nest/install.ts. Started + KeepAlive'd by launchd via
// /Library/LaunchAgents/ai.openape.nest.plist (user domain — daemon
// runs as the human user, not root or _openape_nest yet; that
// privilege-isolation step is Stage 1.5).

import { createServer   } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import process from 'node:process'
import { handleAgentsList, handleAgentSpawn, handleAgentDestroy, handleNestStatus } from './api/agents'
import { NestAuthError, primeJwksCache, verifyNestGrant } from './lib/auth'
import type { NestGrantContext } from './lib/auth'

const HOST = '127.0.0.1'
const PORT = Number(process.env.OPENAPE_NEST_PORT ?? 9091)
const APES_BIN = process.env.OPENAPE_APES_BIN ?? 'apes'

function log(line: string): void {
  process.stderr.write(`${new Date().toISOString()}  ${line}\n`)
}

interface RouteCtx {
  url: URL
  body: unknown
  log: typeof log
  apesBin: string
  caller: string
  grantId: string
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  try { return JSON.parse(text) }
  catch { throw new Error('invalid JSON body') }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendProblem(res: ServerResponse, status: number, title: string): void {
  send(res, status, { type: 'about:blank', status, title })
}

/**
 * Read the Bearer token off the request and verify it produces a grant
 * for `expectedCommand`. On success returns the grant context. On
 * failure sends the 401/403 response itself and returns null — the
 * caller should just `return` after a null.
 */
async function requireNestGrant(
  req: IncomingMessage,
  res: ServerResponse,
  expectedCommand: string[],
): Promise<NestGrantContext | null> {
  const auth = req.headers.authorization
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    sendProblem(res, 401, 'Bearer grant token required')
    return null
  }
  const token = auth.slice(7).trim()
  try {
    return await verifyNestGrant(token, expectedCommand)
  }
  catch (err) {
    if (err instanceof NestAuthError) {
      sendProblem(res, err.status, err.title)
      return null
    }
    sendProblem(res, 401, err instanceof Error ? err.message : String(err))
    return null
  }
}

const server = createServer((req, res) => {
  ;(async () => {
    try {
      const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
      const body = req.method && ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? await readJsonBody(req)
        : {}

      // Each route maps to a fixed grant `command` array. Mutating
      // routes (POST/DELETE) gate themselves in M2; for now only the
      // read-only endpoints are auth-checked.
      if (req.method === 'GET' && url.pathname === '/status') {
        const grant = await requireNestGrant(req, res, ['nest', 'status'])
        if (!grant) return
        log(`nest: GET /status authorized (caller=${grant.caller}, grant=${grant.grantId})`)
        const ctx: RouteCtx = { url, body, log, apesBin: APES_BIN, caller: grant.caller, grantId: grant.grantId }
        return send(res, 200, handleNestStatus(ctx))
      }
      if (req.method === 'GET' && url.pathname === '/agents') {
        const grant = await requireNestGrant(req, res, ['nest', 'list'])
        if (!grant) return
        log(`nest: GET /agents authorized (caller=${grant.caller}, grant=${grant.grantId})`)
        const ctx: RouteCtx = { url, body, log, apesBin: APES_BIN, caller: grant.caller, grantId: grant.grantId }
        return send(res, 200, handleAgentsList(ctx))
      }
      if (req.method === 'POST' && url.pathname === '/agents') {
        // M2 wires this; for now keep the unauthenticated path so
        // existing tooling doesn't break in the middle of the rollout.
        const ctx: RouteCtx = { url, body, log, apesBin: APES_BIN, caller: 'unauth', grantId: 'unauth' }
        const result = await handleAgentSpawn(ctx)
        return send(res, 201, result)
      }
      const destroyMatch = req.method === 'DELETE' && url.pathname.match(/^\/agents\/([^/]+)$/)
      if (destroyMatch) {
        const ctx: RouteCtx = { url, body, log, apesBin: APES_BIN, caller: 'unauth', grantId: 'unauth' }
        const result = await handleAgentDestroy(ctx, destroyMatch[1]!)
        return send(res, 200, result)
      }

      send(res, 404, { error: 'not found' })
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`nest: request failed: ${msg}`)
      send(res, 500, { error: msg })
    }
  })()
})

void primeJwksCache(log)

server.listen(PORT, HOST, () => {
  log(`nest: listening on http://${HOST}:${PORT}`)
})

process.on('SIGTERM', () => {
  log('nest: SIGTERM — shutting down')
  server.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  log('nest: SIGINT — shutting down')
  server.close(() => process.exit(0))
})
