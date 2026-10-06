import type { HtmlPublication } from '@openape/report-contracts/html'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { contentPolicy } from '@openape/report-contracts/html'

export async function openReportUrl(url: string) {
  const target = new URL(url)
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) throw new Error('Refusing to open an unsupported report URL')
  if (target.username || target.password) throw new Error('Report URLs must not contain credentials')
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [url], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Browser opener exited ${code}; open ${url} manually`)))
  })
}
async function listen(server: Server, port = 0) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback listener unavailable')
  return `http://127.0.0.1:${address.port}`
}
export async function previewReport(publication: HtmlPublication, port = 0) {
  const token = randomBytes(24).toString('base64url')
  let viewerOrigin = ''
  const content = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('referrer-policy', 'no-referrer')
    if (request.url !== `/${token}` || request.headers['sec-fetch-dest'] !== 'iframe') { response.writeHead(403); response.end('Use the preview viewer.'); return }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader('content-security-policy', contentPolicy(publication.externalImages.length > 0, viewerOrigin))
    response.setHeader('x-content-type-options', 'nosniff')
    response.end(publication.html)
  })
  const contentOrigin = await listen(content)
  const viewer = createServer((request, response) => {
    if (request.url !== `/${token}`) { response.writeHead(404); response.end(); return }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; frame-src ${contentOrigin}`)
    response.setHeader('referrer-policy', 'no-referrer')
    response.end(`<!doctype html><html lang="en"><title>Reports local preview</title><style>body{font:16px system-ui;margin:20px}iframe{width:100%;height:85vh;border:1px solid #888}</style><h1>Local preview</h1><p>Publisher-trusted active HTML. Application access is isolated; scripts may transmit document data. External images: ${publication.externalImages.length}.</p><iframe title="Report preview" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${contentOrigin}/${token}"></iframe></html>`)
  })
  try {
    viewerOrigin = await listen(viewer, port)
    const url = `${viewerOrigin}/${token}`
    process.stdout.write(`${url}\n`)
    await openReportUrl(url)
    await new Promise<void>((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
  }
  finally {
    await Promise.all([viewer, content].map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
  }
}
