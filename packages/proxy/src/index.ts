#!/usr/bin/env node
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
import { loadMultiAgentConfig } from './config.js'
import { createNodeHandler } from './proxy.js'
import { parseSecretsBlob } from './secrets-store.js'

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c', default: 'config.toml' },
    'dry-run': { type: 'boolean', default: false },
    'mandatory-auth': { type: 'boolean', default: false },
    global: { type: 'boolean', default: false },
    port: { type: 'string' },
  },
})

if (values.global) {
  // --global mode: read secrets TOML from stdin (max 4 KiB enforced by
  // parseSecretsBlob; we cap stdin at 8 KiB to surface oversize input early
  // with a friendlier error than waiting for the parser).
  //
  // Identity load, CA bootstrap, and port binding land in later tasks; for
  // Task 13 we validate the stdin payload, print the loaded secret names, and
  // exit cleanly so callers can verify the wiring end-to-end.
  const stdinBuf: Buffer[] = []
  let total = 0
  let aborted = false
  process.stdin.on('data', (chunk: Buffer) => {
    if (aborted) return
    total += chunk.length
    if (total > 8 * 1024) {
      console.error('[openape-proxy] stdin > 8 KiB, refusing')
      aborted = true
      process.exit(2)
    }
    stdinBuf.push(chunk)
  })
  process.stdin.on('end', () => {
    if (aborted) return
    const blob = Buffer.concat(stdinBuf).toString('utf-8')
    if (!blob.trim()) {
      console.error('[openape-proxy] --global requires secrets TOML on stdin')
      process.exit(2)
    }
    let store
    try {
      store = parseSecretsBlob(blob)
    }
    catch (err) {
      console.error(`[openape-proxy] secrets parse error: ${(err as Error).message}`)
      process.exit(2)
    }
    const names = store.entries.map(e => e.name).join(', ')
    console.log(`[openape-proxy] loaded ${store.entries.length} secrets: ${names}`)
    process.exit(0)
  })
  process.stdin.resume()
}
else {
  const configPath = values.config!

  console.log(`[openape-proxy] Loading config from ${configPath}`)
  const config = loadMultiAgentConfig(configPath, {
    mandatoryAuth: values['mandatory-auth'] || undefined,
  })

  if (values['dry-run']) {
    console.log('[openape-proxy] DRY RUN mode — logging only, not blocking')
    console.log('[openape-proxy] Config loaded:')
    console.log(`  Listen: ${config.proxy.listen}`)
    console.log(`  Default action: ${config.proxy.default_action}`)
    console.log(`  Mandatory auth: ${config.proxy.mandatory_auth ?? false}`)
    console.log(`  Agents: ${config.agents.length}`)
    for (const agent of config.agents) {
      const allowCount = agent.allow?.length ?? 0
      const denyCount = agent.deny?.length ?? 0
      const grantCount = agent.grant_required?.length ?? 0
      console.log(`    ${agent.email} (${agent.idp_url}) — ${allowCount} allow, ${denyCount} deny, ${grantCount} grant`)
    }
    process.exit(0)
  }

  const handler = createNodeHandler(config)

  const port = Number.parseInt(config.proxy.listen.split(':')[1] || '9090')
  const hostname = config.proxy.listen.split(':')[0] || '127.0.0.1'

  const server = createServer(handler.handleRequest)
  server.on('connect', handler.handleConnect)

  server.listen(port, hostname, () => {
    // When configured with port 0, the OS assigns a free port — use the actual
    // bound port for the log line so external orchestrators (apes proxy --) can
    // grep this line to discover where to connect.
    const addr = server.address()
    const actualPort = typeof addr === 'object' && addr ? addr.port : port
    console.log(`[openape-proxy] Listening on http://${hostname}:${actualPort}`)
    console.log(`[openape-proxy] CONNECT tunneling enabled`)
    console.log(`[openape-proxy] Mandatory auth: ${config.proxy.mandatory_auth ?? false}`)
    console.log(`[openape-proxy] Agents: ${config.agents.map(a => a.email).join(', ')}`)
    console.log(`[openape-proxy] Default action: ${config.proxy.default_action}`)
  })

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[openape-proxy] Shutting down...')
    server.close()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('[openape-proxy] Shutting down...')
    server.close()
    process.exit(0)
  })
}
