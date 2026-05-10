// OpenApe Nest daemon — local control-plane that hosts agents on this
// computer. Listens on 127.0.0.1:9091, gated by DDISA grant tokens
// (see lib/auth.ts).
//
// As of Phase B (#sim-arch) the Nest also supervises one chat-bridge
// process per registered agent in-daemon (see lib/supervisor.ts).
// New spawns no longer install per-agent system-domain launchd plists
// in /Library/LaunchDaemons/ — there's just one launchd entry for the
// Nest itself, and it owns the rest. PR #376's host-PATH-capture fixed
// the PATH-inheritance bug that killed the previous in-daemon
// supervisor (deleted in PR #365), so it's safe to bring it back.
//
// Bootstrapped by `apes nest install`. Started + KeepAlive'd by
// launchd (system-domain after `apes nest migrate-to-service-user`,
// user-domain otherwise).

import { createServer   } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import process from 'node:process'
import { handleAgentsList, handleAgentSpawn, handleAgentDestroy, handleNestStatus } from './api/agents'
import { NestAuthError, primeJwksCache, verifyNestGrant } from './lib/auth'
import type { NestGrantContext } from './lib/auth'
import { listAgents } from './lib/registry'
import { Supervisor } from './lib/supervisor'

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
  supervisor: Supervisor
}

const supervisor = new Supervisor({ apesBin: APES_BIN, log })

// Reconcile from the persisted registry on boot — re-spawns the
// chat-bridge child for every agent that was registered before the
// last daemon shutdown.
supervisor.reconcile(listAgents())
log(`nest: supervisor reconciled, ${supervisor.size()} bridge process(es) starting`)

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
        const ctx: RouteCtx = { url, body, log, apesBin: APES_BIN, caller: grant.caller, grantId: grant.grantId, supervisor }
        return send(res, 200, handleNestStatus(ctx))
      }
      if (req.method === 'GET' && url.pathname === '/agents') {
        const grant = await requireNestGrant(req, res, ['nest', 'list'])
        if (!grant) return
        log(`nest: GET /agents authorized (caller=${grant.caller}, grant=${grant.grantId})`)
        const ctx: RouteCtx = { url, body, log, apesBin: APES_BIN, caller: grant.caller, grantId: grant.grantId, supervisor }
        return send(res, 200, handleAgentsList(ctx))
      }
      if (req.method === 'POST' && url.pathname === '/agents') {
        const name = (body as { name?: unknown } | undefined)?.name
        if (typeof name !== 'string' || !name) {
          return sendProblem(res, 400, 'POST /agents requires body.name (string)')
        }
        // Grant scope is `nest spawn` (no name baked in) — one
        // approval covers any future spawn. The agent name comes
        // from the request body; the grant doesn't constrain it.
        // Mirror semantics for destroy is intentionally tighter
        // (per-name) — see api/agents.ts comment + `apes nest spawn`.
        const grant = await requireNestGrant(req, res, ['nest', 'spawn'])
        if (!grant) return
        log(`nest: POST /agents (spawn ${name}) authorized (caller=${grant.caller}, grant=${grant.grantId})`)
        const ctx: RouteCtx = { url, body, log, apesBin: APES_BIN, caller: grant.caller, grantId: grant.grantId, supervisor }
        const result = await handleAgentSpawn(ctx)
        return send(res, 201, result)
      }
      const destroyMatch = req.method === 'DELETE' && url.pathname.match(/^\/agents\/([^/]+)$/)
      if (destroyMatch) {
        const name = destroyMatch[1]!
        const grant = await requireNestGrant(req, res, ['nest', 'destroy', name])
        if (!grant) return
        log(`nest: DELETE /agents/${name} authorized (caller=${grant.caller}, grant=${grant.grantId})`)
        const ctx: RouteCtx = { url, body, log, apesBin: APES_BIN, caller: grant.caller, grantId: grant.grantId, supervisor }
        const result = await handleAgentDestroy(ctx, name)
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
  log('nest: SIGTERM — stopping supervisor')
  supervisor.stopAll()
  server.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  log('nest: SIGINT — stopping supervisor')
  supervisor.stopAll()
  server.close(() => process.exit(0))
})
