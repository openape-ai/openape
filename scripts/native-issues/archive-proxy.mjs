import { createServer, request } from 'node:http'

export function frozenIssueWrite(method, path, { repository, attachments = [], actors = [] }) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false
  let pathname
  try { pathname = decodeURIComponent(new URL(path, 'http://localhost').pathname).replace(/\/+$/, '') }
  catch { return true }
  const repo = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`^/(?:api/v1/repos/)?${repo}/(?:issues|labels|milestones|projects|settings)(?:/|$)`, 'i').test(pathname)) return true
  if (new RegExp(`^/api/v1/repos/${repo}(?:/transfer)?$`, 'i').test(pathname)) return true
  if (pathname === '/attachments' || pathname.startsWith('/attachments/') || attachments.some(id => pathname === `/attachments/${id}`)) return true
  if (actors.some(actor => pathname === `/api/v1/admin/users/${actor.login}` || pathname === `/admin/users/${actor.id}/delete`)) return true
  return false
}

export function createArchiveProxy({ upstream, repository, attachments, actors, legacyPage }) {
  const origin = new URL(upstream)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/' || origin.username || origin.password) throw new Error('The archive proxy must target a loopback Forgejo listener')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Explicit source repository is required')
  return createServer((incoming, outgoing) => {
    const path = incoming.url ?? '/'
    if (!path.startsWith('/') || path.startsWith('//')) { outgoing.writeHead(400); outgoing.end('Invalid request target'); return }
    if (frozenIssueWrite(incoming.method ?? 'GET', incoming.url ?? '/', { repository, attachments, actors })) {
      outgoing.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '3600' })
      outgoing.end(JSON.stringify({ message: 'Development issue writes are paused for migration. Git and CI remain available.' }))
      incoming.resume()
      return
    }
    const pathname = new URL(incoming.url ?? '/', origin).pathname
    if (legacyPage && incoming.method === 'GET' && pathname.startsWith(`/${repository}/issues/`) && /^\d+$/.test(pathname.split('/').at(-1))) {
      outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
      outgoing.end(legacyPage)
      return
    }
    const target = new URL(origin)
    target.pathname = path.split('?')[0]
    target.search = path.includes('?') ? path.slice(path.indexOf('?')) : ''
    const forwarded = request(target, { method: incoming.method, headers: incoming.headers, timeout: 60000 }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(outgoing)
    })
    forwarded.on('timeout', () => forwarded.destroy(new Error('Upstream timeout')))
    forwarded.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502, { 'cache-control': 'no-store' }); outgoing.end('Archive upstream unavailable') })
    incoming.on('aborted', () => forwarded.destroy())
    incoming.pipe(forwarded)
  })
}
