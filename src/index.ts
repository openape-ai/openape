#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { loadConfig } from './config.js'
import { createProxy } from './proxy.js'
import { initAudit } from './audit.js'

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c', default: 'config.toml' },
    'dry-run': { type: 'boolean', default: false },
  },
})

const configPath = values.config!

console.log(`[openape-proxy] Loading config from ${configPath}`)
const config = loadConfig(configPath)

// Init audit log
initAudit(config.proxy.audit_log)

if (values['dry-run']) {
  console.log('[openape-proxy] DRY RUN mode — logging only, not blocking')
  // In dry-run mode, we could override deny rules to just log
  // For now, just print config and exit
  console.log('[openape-proxy] Config loaded:')
  console.log(`  Listen: ${config.proxy.listen}`)
  console.log(`  IdP: ${config.proxy.idp_url}`)
  console.log(`  Agent: ${config.proxy.agent_email}`)
  console.log(`  Default action: ${config.proxy.default_action}`)
  console.log(`  Allow rules: ${config.allow.length}`)
  console.log(`  Deny rules: ${config.deny.length}`)
  console.log(`  Grant rules: ${config.grant_required.length}`)
  process.exit(0)
}

const proxy = createProxy(config)

const server = Bun.serve({
  port: proxy.port,
  hostname: proxy.hostname,
  fetch: proxy.fetch,
})

console.log(`[openape-proxy] 🐾 Listening on http://${server.hostname}:${server.port}`)
console.log(`[openape-proxy] IdP: ${config.proxy.idp_url}`)
console.log(`[openape-proxy] Agent: ${config.proxy.agent_email}`)
console.log(`[openape-proxy] Rules: ${config.allow.length} allow, ${config.deny.length} deny, ${config.grant_required.length} grant-required`)
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
