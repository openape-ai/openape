import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { chmod, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assistantProvenance, parseCodexRequest } from '../../contracts/codex'
import type { CodexRequest } from '../../contracts/codex'
import { LoginRequiredError } from './session'
import { privateSocketDirectory } from './socket-path'
import type { McpPeer } from './session'
import type { OwnerSession } from '../connections/owner-session'
import type { McpSessionStatus } from '../../contracts/mcp-session'

const maximumLine = 1024 * 1024
const maximumInFlight = 16

export interface McpSessionGate {
  authorize: (peer: McpPeer, secret: string | undefined) => Promise<void>
  status: (peer: McpPeer) => McpSessionStatus
  owner: (peer: McpPeer) => OwnerSession | null
  disconnect: (peer: McpPeer) => void
}

function parseFrame(value: unknown): { request: CodexRequest, secret: string | undefined } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Codex request')
  const { session, ...request } = value as Record<string, unknown>
  if (session !== undefined && (typeof session !== 'string' || session.length > 128)) throw new Error('Invalid Codex request')
  return { request: parseCodexRequest(request), secret: session }
}

// Local socket for the Codex MCP shim. The directory and socket are private to
// the macOS user. Each shim process keeps one connection; every line carries one
// pods_control request, answered by its id, and must hold the session secret
// that main sent on this same connection after the owner's sign-in. Only the
// session action, which reports the sign-in state, needs no secret.
export class CodexControlServer {
  private server: Server | undefined
  private readonly sockets = new Set<Socket>()
  constructor(private readonly endpoint: string, private readonly execute: (request: CodexRequest, owner: OwnerSession | null) => Promise<unknown>, private readonly sessions: McpSessionGate) {}

  async start(): Promise<void> {
    if (this.server) return
    await privateSocketDirectory(dirname(this.endpoint))
    await rm(this.endpoint, { force: true })
    const server = createServer(socket => this.accept(socket))
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.endpoint, resolve) })
    await chmod(this.endpoint, 0o600)
    this.server = server
  }

  async stop(): Promise<void> {
    const server = this.server; this.server = undefined
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(this.endpoint, { force: true })
  }

  private accept(socket: Socket): void {
    const write = (frame: Record<string, unknown>) => { if (!socket.destroyed) socket.write(`${JSON.stringify(frame)}\n`) }
    const peer: McpPeer = { get closed() { return socket.destroyed }, send: write }
    const inFlight = new Set<string>()
    let buffer = ''
    this.sockets.add(socket)
    socket.on('close', () => { this.sockets.delete(socket); this.sessions.disconnect(peer) })
    socket.on('error', () => socket.destroy())
    socket.on('data', (bytes) => {
      buffer += bytes.toString('utf8')
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (line.length > maximumLine) { socket.destroy(); return }
        let frame: ReturnType<typeof parseFrame>
        try { frame = parseFrame(JSON.parse(line)) }
        catch (error) { write({ id: null, error: error instanceof Error ? error.message : 'Invalid Codex request' }); continue }
        const { request, secret } = frame
        // The shim never reuses an id while it is running, so a duplicate is a foreign or broken client.
        if (inFlight.has(request.id)) { socket.destroy(); return }
        // The session state is always readable, so the tool user can wait for the owner's sign-in.
        if (request.action.action === 'session') { write(Object.keys(request.action).length === 1 ? { id: request.id, result: this.sessions.status(peer) } : { id: request.id, error: 'The session action takes no other fields' }); continue }
        if (inFlight.size >= maximumInFlight) { write({ id: request.id, error: 'Too many concurrent Pods calls; wait for a running call to finish' }); continue }
        inFlight.add(request.id)
        void this.sessions.authorize(peer, secret)
          .then(() => this.execute(assistantProvenance(request), this.sessions.owner(peer))
            .then(result => ({ id: request.id, result }), (error: unknown) => ({ id: request.id, error: error instanceof Error ? error.message : 'Codex action failed' })), (error: unknown) => ({ id: request.id, error: error instanceof Error ? error.message : 'Sign-in required', ...(error instanceof LoginRequiredError ? { code: error.code, status: error.session } : {}) }))
          .then((reply) => { inFlight.delete(request.id); write(reply) })
      }
      if (buffer.length > maximumLine) socket.destroy()
    })
  }
}
