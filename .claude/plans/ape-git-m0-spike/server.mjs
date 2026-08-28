// M0-Spike ape-git: grant-gated git smart HTTP via `git http-backend`.
// Wegwerf-Code — beweist Transport + DDISA-JWT-Auth + Scope-Gate, mehr nicht.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const ROOT = dirname(fileURLToPath(import.meta.url))
const GIT_PROJECT_ROOT = join(ROOT, 'repos')
const PORT = 3300
const JWKS = createRemoteJWKSet(new URL('https://id.openape.ai/.well-known/jwks.json'))

// ponytail: scopes.json statt echter Grant-API — die kommt in M1
function scopeFor(email, repo) {
  const scopes = JSON.parse(readFileSync(join(ROOT, 'scopes.json'), 'utf8'))
  return scopes[repo]?.[email] ?? null
}

async function authenticate(req) {
  const header = req.headers.authorization ?? ''
  if (!header.startsWith('Basic ')) return null
  const [, token] = Buffer.from(header.slice(6), 'base64').toString().split(':')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: 'https://id.openape.ai' })
    return payload.sub
  } catch {
    return null
  }
}

function deny(res, status, message) {
  const headers = { 'Content-Type': 'text/plain' }
  if (status === 401) headers['WWW-Authenticate'] = 'Basic realm="ape-git"'
  res.writeHead(status, headers)
  res.end(`${message}\n`)
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end('{"ok":true}\n')
  }
  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+\.git)(\/.*)$/)
  if (!match) return deny(res, 404, 'not found')
  const repo = `${match[1]}/${match[2]}`

  const email = await authenticate(req)
  if (!email) return deny(res, 401, 'ape-git: valid DDISA token required')

  const service = url.searchParams.get('service') ?? url.pathname.split('/').pop()
  const isWrite = service === 'git-receive-pack'
  const scope = scopeFor(email, repo)
  if (!scope) return deny(res, 403, `ape-git: no grant for ${email} on ${repo}`)
  if (isWrite && scope !== 'write')
    return deny(res, 403, `ape-git: grant for ${email} on ${repo} is git:read — push denied`)

  const env = {
    ...process.env,
    GIT_PROJECT_ROOT,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: url.pathname,
    QUERY_STRING: url.search.slice(1),
    REQUEST_METHOD: req.method,
    REMOTE_USER: email,
    REMOTE_ADDR: req.socket.remoteAddress ?? '',
  }
  if (req.headers['content-type']) env.CONTENT_TYPE = req.headers['content-type']
  if (req.headers['content-length']) env.CONTENT_LENGTH = req.headers['content-length']
  if (req.headers['content-encoding']) env.HTTP_CONTENT_ENCODING = req.headers['content-encoding']
  if (req.headers['git-protocol']) env.HTTP_GIT_PROTOCOL = req.headers['git-protocol']

  const cgi = spawn('git', ['http-backend'], { env })
  req.pipe(cgi.stdin)

  let head = Buffer.alloc(0)
  let headersSent = false
  cgi.stdout.on('data', (chunk) => {
    if (headersSent) return res.write(chunk)
    head = Buffer.concat([head, chunk])
    const split = head.indexOf('\r\n\r\n')
    if (split === -1) return
    const headers = {}
    let status = 200
    for (const line of head.subarray(0, split).toString().split('\r\n')) {
      const [key, value] = line.split(/:\s(.*)/)
      if (key.toLowerCase() === 'status') status = Number.parseInt(value)
      else headers[key] = value
    }
    res.writeHead(status, headers)
    headersSent = true
    res.write(head.subarray(split + 4))
  })
  cgi.stdout.on('end', () => res.end())
  cgi.stderr.on('data', d => console.error('[http-backend]', d.toString().trim()))
  cgi.on('error', err => deny(res, 500, `spawn failed: ${err.message}`))
}).listen(PORT, () => console.log(`ape-git spike on http://localhost:${PORT}, repos in ${GIT_PROJECT_ROOT}`))
