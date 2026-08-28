import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'

export interface GitCgiOptions {
  projectRoot: string
  pathInfo: string
  queryString: string
  remoteUser: string
  /** Extra env for the CGI process — receive-pack and hooks inherit it. */
  env?: Record<string, string>
}

/**
 * Bridge one smart-HTTP request to `git http-backend` (CGI). Git's own binary
 * speaks the entire wire protocol; we only translate HTTP <-> CGI and stream
 * both directions. Proven against the 74 MB monorepo in the M0 spike.
 */
export function runGitHttpBackend(req: IncomingMessage, res: ServerResponse, options: GitCgiOptions): Promise<void> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...options.env,
    GIT_PROJECT_ROOT: options.projectRoot,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: options.pathInfo,
    QUERY_STRING: options.queryString,
    REQUEST_METHOD: req.method ?? 'GET',
    REMOTE_USER: options.remoteUser,
    REMOTE_ADDR: req.socket.remoteAddress ?? '',
  }
  if (req.headers['content-type']) env.CONTENT_TYPE = req.headers['content-type']
  if (req.headers['content-length']) env.CONTENT_LENGTH = req.headers['content-length']
  if (req.headers['content-encoding']) env.HTTP_CONTENT_ENCODING = String(req.headers['content-encoding'])
  // Without this git silently falls back to protocol v0.
  if (req.headers['git-protocol']) env.HTTP_GIT_PROTOCOL = String(req.headers['git-protocol'])

  return new Promise((resolvePromise) => {
    const cgi = spawn('git', ['http-backend'], { env })
    req.pipe(cgi.stdin)

    let head = Buffer.alloc(0)
    let headersSent = false
    cgi.stdout.on('data', (chunk: Buffer) => {
      if (headersSent) {
        res.write(chunk)
        return
      }
      head = Buffer.concat([head, chunk])
      const split = head.indexOf('\r\n\r\n')
      if (split === -1) return
      const headers: Record<string, string> = {}
      let status = 200
      for (const line of head.subarray(0, split).toString().split('\r\n')) {
        const [key, value] = line.split(/:\s(.*)/)
        if (!key || value === undefined) continue
        if (key.toLowerCase() === 'status') status = Number.parseInt(value)
        else headers[key] = value
      }
      res.writeHead(status, headers)
      headersSent = true
      res.write(head.subarray(split + 4))
    })
    cgi.stdout.on('end', () => {
      res.end()
      resolvePromise()
    })
    cgi.stderr.on('data', (data: Buffer) => console.error('[git http-backend]', data.toString().trim()))
    cgi.on('error', (err) => {
      console.error('[git http-backend] spawn failed:', err.message)
      if (!headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('ape-git: git http-backend unavailable\n')
      }
      else {
        res.end()
      }
      resolvePromise()
    })
  })
}
