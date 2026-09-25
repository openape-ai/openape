import { createServer } from 'node:net'
import type { Server } from 'node:net'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseCodexRequest } from '../../contracts/codex'
import type { CodexRequest } from '../../contracts/codex'

const maximumLine = 1024 * 1024

// Local socket for the Codex MCP shim. The directory and socket are private to
// the macOS user, and each line carries exactly one pods_control request.
export class CodexControlServer {
  private server: Server | undefined
  constructor(private readonly endpoint: string, private readonly execute: (request: CodexRequest) => Promise<unknown>) {}

  async start(): Promise<void> {
    if (this.server) return
    await mkdir(dirname(this.endpoint), { recursive: true, mode: 0o700 }); await chmod(dirname(this.endpoint), 0o700)
    await rm(this.endpoint, { force: true })
    const server = createServer((socket) => {
      let buffer = ''; let busy = false
      socket.on('error', () => socket.destroy())
      socket.on('data', (bytes) => {
        buffer += bytes.toString('utf8')
        if (buffer.length > maximumLine) { socket.destroy(); return }
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        if (busy) { socket.destroy(); return }
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (buffer.includes('\n')) { socket.destroy(); return }
        let request: CodexRequest
        try { request = parseCodexRequest(JSON.parse(line)) }
        catch (error) { socket.write(`${JSON.stringify({ id: null, error: error instanceof Error ? error.message : 'Invalid Codex request' })}\n`); return }
        busy = true
        void this.execute(request)
          .then(result => ({ id: request.id, result }), (error: unknown) => ({ id: request.id, error: error instanceof Error ? error.message : 'Codex action failed' }))
          .then((reply) => { busy = false; if (!socket.destroyed) socket.write(`${JSON.stringify(reply)}\n`) })
      })
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.endpoint, resolve) })
    await chmod(this.endpoint, 0o600)
    this.server = server
  }

  async stop(): Promise<void> {
    const server = this.server; this.server = undefined
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(this.endpoint, { force: true })
  }
}
