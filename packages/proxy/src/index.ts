#!/usr/bin/env node
import type { DaemonIdentity, MultiAgentProxyConfig } from './types.js'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createLeafCertCache, loadOrCreateCa } from './ca-store.js'
import { loadMultiAgentConfig } from './config.js'
import { createNodeHandler } from './proxy.js'
import { parseSecretsBlob } from './secrets-store.js'

function loadIdentity(): DaemonIdentity {
  const path = join(homedir(), '.config', 'apes', 'auth.json')
  if (!existsSync(path)) {
    console.error(`[openape-proxy] missing ${path} — run \`apes login\` first`)
    process.exit(2)
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { email?: string, idp?: string, bearer?: string }
  if (!raw.email || !raw.idp || !raw.bearer) {
    console.error(`[openape-proxy] malformed ${path} — re-run \`apes login\``)
    process.exit(2)
  }
  return { email: raw.email, idpUrl: raw.idp, bearer: raw.bearer }
}

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
    const identity = loadIdentity()
    const port = Number.parseInt(values.port ?? '18789')

    // Bootstrap (or reuse) the per-user MITM CA stored under
    // ~/.openape/proxy/. Tagging the CN with the operator email keeps
    // multi-account dev machines self-explanatory in the system trust store.
    const ca = loadOrCreateCa({
      certPath: join(homedir(), '.openape', 'proxy', 'ca.crt'),
      keyPath: join(homedir(), '.openape', 'proxy', 'ca.key'),
      subjectCN: `OpenApe Proxy CA (${identity.email})`,
    })
    if (ca.created) {
      console.log(`[openape-proxy] generated new CA at ~/.openape/proxy/ca.crt`)
    }
    const leafCache = createLeafCertCache(ca, { capacity: 256 })

    // Daemon mode synthesizes a minimal MultiAgentProxyConfig from the loaded
    // identity. `default_action: 'allow'` keeps Task 15 a pure bind/CA wiring
    // milestone — Task 16 will add the daemon-mode auth bypass on top.
    const config: MultiAgentProxyConfig = {
      proxy: { listen: `127.0.0.1:${port}`, default_action: 'allow' },
      agents: [{ email: identity.email, idp_url: identity.idpUrl }],
    }

    const handler = createNodeHandler(config, { secretsStore: store, leafCache, daemonMode: true })
    const server = createServer(handler.handleRequest)
    server.on('connect', handler.handleConnect)
    server.listen(port, '127.0.0.1', () => {
      // `--port 0` lets the OS pick a free port — surface the actual bound
      // port so harness/orchestrators can grep the banner reliably.
      const addr = server.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      // Emit identity / secrets / OPENAPE_PROXY hint BEFORE the canonical
      // `listening on 127.0.0.1:<port>` banner. The banner is what spawners
      // grep to confirm the daemon is up; printing the hint first guarantees
      // it lives in the same captured chunk that the spawner reads.
      console.log(`[openape-proxy] identity: ${identity.email} (${identity.idpUrl})`)
      const names = store.entries.map(e => e.name).join(', ')
      console.log(`[openape-proxy] secrets: ${names}`)
      console.log(`[openape-proxy] export OPENAPE_PROXY=127.0.0.1:${actualPort}`)
      console.log(`[openape-proxy] listening on 127.0.0.1:${actualPort}`)
    })

    process.on('SIGINT', () => server.close(() => process.exit(0)))
    process.on('SIGTERM', () => server.close(() => process.exit(0)))
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
