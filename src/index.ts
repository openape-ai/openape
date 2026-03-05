#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { loadMultiAgentConfig } from './config.js'
import { createMultiAgentProxy } from './proxy.js'
import { initAudit } from './audit.js'

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

// Init audit log
initAudit(config.proxy.audit_log)

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

const proxy = createMultiAgentProxy(config)

const server = Bun.serve({
  port: proxy.port,
  hostname: proxy.hostname,
  fetch: proxy.fetch,
})

console.log(`[openape-proxy] Listening on http://${server.hostname}:${server.port}`)
console.log(`[openape-proxy] Mandatory auth: ${config.proxy.mandatory_auth ?? false}`)
console.log(`[openape-proxy] Agents: ${config.agents.map(a => a.email).join(', ')}`)
console.log(`[openape-proxy] Default action: ${config.proxy.default_action}`)

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[openape-proxy] Shutting down...')
  server.stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('[openape-proxy] Shutting down...')
  server.stop()
  process.exit(0)
})
