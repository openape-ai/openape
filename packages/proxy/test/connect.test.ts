import { createServer } from 'node:http'
import { connect } from 'node:net'
import { describe, expect, it, afterEach } from 'vitest'
import type { MultiAgentProxyConfig } from '../src/types.js'
import { handleConnect } from '../src/connect.js'
import { buildGrantsClients } from '../src/proxy.js'

function makeConfig(overrides?: Partial<MultiAgentProxyConfig['proxy']>): MultiAgentProxyConfig {
  return {
    proxy: {
      listen: '127.0.0.1:0',
      default_action: 'block',
      mandatory_auth: true,
      ...overrides,
    },
    agents: [{
      email: 'bot@example.com',
      idp_url: 'https://id.example.com',
    }],
  }
}

function startProxy(config: MultiAgentProxyConfig): Promise<{ port: number, close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    const grantsClients = buildGrantsClients(config)
    server.on('connect', (req, socket, head) => {
      handleConnect(config, grantsClients, req, socket, head)
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({
        port: addr.port,
        close: () => new Promise<void>(r => server.close(() => r())),
      })
    })
  })
}

function sendConnect(proxyPort: number, target: string, headers?: Record<string, string>): Promise<{ statusLine: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, '127.0.0.1', () => {
      let headerStr = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n`
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          headerStr += `${k}: ${v}\r\n`
        }
      }
      headerStr += '\r\n'
      socket.write(headerStr)
    })

    let data = ''
    socket.on('data', (chunk) => {
      data += chunk.toString()
      if (data.includes('\r\n\r\n')) {
        const statusLine = data.split('\r\n')[0]
        socket.destroy()
        resolve({ statusLine })
      }
    })

    socket.on('error', reject)
    socket.setTimeout(3000, () => {
      socket.destroy()
      reject(new Error('Timeout'))
    })
  })
}

describe('connect handler', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (cleanup) {
      await cleanup()
      cleanup = undefined
    }
  })

  it('blocks CONNECT to loopback IP (SSRF)', async () => {
    const config = makeConfig({ mandatory_auth: false })
    config.agents = [{ email: 'bot@example.com', idp_url: 'https://id.example.com' }]
    const { port, close } = await startProxy(config)
    cleanup = close

    const { statusLine } = await sendConnect(port, '127.0.0.1:3000')
    expect(statusLine).toContain('403')
  })

  it('blocks CONNECT to private IP (SSRF)', async () => {
    const config = makeConfig({ mandatory_auth: false })
    config.agents = [{ email: 'bot@example.com', idp_url: 'https://id.example.com' }]
    const { port, close } = await startProxy(config)
    cleanup = close

    const { statusLine } = await sendConnect(port, '10.0.0.1:80')
    expect(statusLine).toContain('403')
  })

  it('returns 401 without JWT when mandatory auth is enabled', async () => {
    const config = makeConfig({ mandatory_auth: true })
    const { port, close } = await startProxy(config)
    cleanup = close

    const { statusLine } = await sendConnect(port, 'httpbin.org:443')
    expect(statusLine).toContain('401')
  })

  it('returns 401 with invalid JWT when mandatory auth is enabled', async () => {
    const config = makeConfig({ mandatory_auth: true })
    const { port, close } = await startProxy(config)
    cleanup = close

    const { statusLine } = await sendConnect(port, 'httpbin.org:443', {
      'Proxy-Authorization': 'Bearer invalid.token.here',
    })
    expect(statusLine).toContain('401')
  })

  it('blocks malformed target (treated as SSRF)', async () => {
    const config = makeConfig({ mandatory_auth: false })
    config.agents = [{ email: 'bot@example.com', idp_url: 'https://id.example.com' }]
    const { port, close } = await startProxy(config)
    cleanup = close

    const { statusLine } = await sendConnect(port, 'not-a-host')
    expect(statusLine).toContain('403')
  })
})
