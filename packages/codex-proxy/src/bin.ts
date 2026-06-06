import { createCodexProxyServer } from './server'

// Standalone entry: the nest starts this on loopback (replaces the litellm
// container). Non-blocking — serves /health immediately and only fails a chat
// request until the Codex credential is seeded at CODEX_CREDENTIAL_PATH.

const port = Number(process.env.CODEX_PROXY_PORT ?? process.env.PORT ?? 4000)
const host = process.env.CODEX_PROXY_HOST ?? '127.0.0.1'
const credentialPath = process.env.CODEX_CREDENTIAL_PATH

if (!credentialPath) {
  console.error('codex-proxy: CODEX_CREDENTIAL_PATH is required')
  process.exit(1)
}

const server = createCodexProxyServer({ credentialPath, originator: process.env.CODEX_ORIGINATOR })
server.listen(port, host, () => {
  console.log(`codex-proxy listening on http://${host}:${port} (credential: ${credentialPath})`)
})
