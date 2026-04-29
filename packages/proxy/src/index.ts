#!/usr/bin/env node
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
import { loadMultiAgentConfig } from './config.js'
import { createNodeHandler } from './proxy.js'

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c', default: 'config.toml' },
    'dry-run': { type: 'boolean', default: false },
    'mandatory-auth': { type: 'boolean', default: false },
  },
})

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
