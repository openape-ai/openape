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

const server = createServer((req, res) => {
  ;(async () => {
    try {
      const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
      const body = req.method && ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? await readJsonBody(req)
        : {}
      const ctx: RouteCtx = { url, body, log, apesBin: APES_BIN }

      if (req.method === 'GET' && url.pathname === '/status') {
        return send(res, 200, handleNestStatus(ctx))
      }
      if (req.method === 'GET' && url.pathname === '/agents') {
        return send(res, 200, handleAgentsList(ctx))
      }
      if (req.method === 'POST' && url.pathname === '/agents') {
        const result = await handleAgentSpawn(ctx)
        return send(res, 201, result)
      }
      const destroyMatch = req.method === 'DELETE' && url.pathname.match(/^\/agents\/([^/]+)$/)
      if (destroyMatch) {
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
