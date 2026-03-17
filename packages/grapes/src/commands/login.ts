import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { defineCommand } from 'citty'
import { generateCodeChallenge, generateCodeVerifier } from '@openape/core'
import consola from 'consola'
import { loadConfig, saveAuth } from '../config'
import { getAgentAuthenticateEndpoint, getAgentChallengeEndpoint } from '../http'

const CALLBACK_PORT = 9876
const CLIENT_ID = 'grapes-cli'

export const loginCommand = defineCommand({
  meta: {
    name: 'login',
    description: 'Authenticate with an OpenAPE IdP',
  },
  args: {
    idp: {
      type: 'string',
      description: 'IdP URL (e.g. https://id.openape.at)',
    },
    key: {
      type: 'string',
      description: 'Path to agent private key (agent mode)',
    },
    email: {
      type: 'string',
      description: 'Agent email (for DNS discovery)',
    },
  },
  async run({ args }) {
    const config = loadConfig()
    const idp = args.idp || process.env.GRAPES_IDP || config.defaults?.idp

    if (!idp) {
      consola.error('IdP URL required. Use --idp <url> or set GRAPES_IDP.')
      return process.exit(1)
    }

    if (args.key) {
      await loginWithKey(idp, args.key, args.email)
    } else {
      await loginWithPKCE(idp)
    }
  },
})

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  execFile(cmd, [url], () => {})
}

async function loginWithPKCE(idp: string) {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const redirectUri = `http://localhost:${CALLBACK_PORT}/callback`

  const state = crypto.randomUUID()
  const nonce = crypto.randomUUID()

  const authUrl = new URL(`${idp}/authorize`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('scope', 'openid email profile offline_access')

  // Start local callback server
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`)
      if (url.pathname === '/callback') {
        const authCode = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<h1>Login failed</h1><p>You can close this window.</p>')
          server.close()
          reject(new Error(`Auth error: ${error}`))
          return
        }

        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<h1>Login successful!</h1><p>You can close this window.</p>')
          server.close()
          resolve(authCode)
          return
        }

        res.writeHead(400)
        res.end('Missing code')
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    server.listen(CALLBACK_PORT, () => {
      consola.info(`Opening browser for login at ${idp}...`)
      openBrowser(authUrl.toString())
    })

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('Login timed out'))
    }, 300_000)
    timeout.unref()
  })

  // Exchange code for tokens
  const tokenResponse = await fetch(`${idp}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
    }),
  })

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text()
    consola.error(`Token exchange failed: ${text}`)
    return process.exit(1)
  }

  const tokens = await tokenResponse.json() as {
    access_token?: string
    id_token?: string
    refresh_token?: string
    expires_in?: number
    assertion?: string
  }

  const accessToken = tokens.access_token || tokens.id_token || tokens.assertion
  if (!accessToken) {
    consola.error('No access token received')
    return process.exit(1)
  }

  // Decode JWT to get email
  const payload = JSON.parse(atob(accessToken.split('.')[1]))

  saveAuth({
    idp,
    access_token: accessToken,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    email: payload.email || payload.sub,
    expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
  })

  consola.success(`Logged in as ${payload.email || payload.sub}`)
}

async function loginWithKey(idp: string, keyPath: string, email?: string) {
  const { readFileSync } = await import('node:fs')
  const { sign } = await import('node:crypto')
  const { loadEd25519PrivateKey } = await import('../ssh-key.js')

  const agentEmail = email
  if (!agentEmail) {
    consola.error('Agent email required for key-based login. Use --email <agent-email>')
    return process.exit(1)
  }

  // Use challenge-response auth (endpoint resolved via OIDC discovery)
  const challengeUrl = await getAgentChallengeEndpoint(idp)
  const challengeResp = await fetch(challengeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentEmail }),
  })

  if (!challengeResp.ok) {
    consola.error(`Challenge failed: ${await challengeResp.text()}`)
    return process.exit(1)
  }

  const { challenge } = await challengeResp.json() as { challenge: string }

  // Sign challenge with Ed25519 private key (supports OpenSSH + PKCS8 format)
  const keyContent = readFileSync(keyPath, 'utf-8')
  const privateKey = loadEd25519PrivateKey(keyContent)
  const signature = sign(null, Buffer.from(challenge), privateKey).toString('base64')

  // Authenticate (endpoint resolved via OIDC discovery)
  const authenticateUrl = await getAgentAuthenticateEndpoint(idp)
  const authResp = await fetch(authenticateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: agentEmail,
      challenge,
      signature,
    }),
  })

  if (!authResp.ok) {
    consola.error(`Authentication failed: ${await authResp.text()}`)
    return process.exit(1)
  }

  const { token, expires_in } = await authResp.json() as { token: string, expires_in: number }

  saveAuth({
    idp,
    access_token: token,
    email: agentEmail,
    expires_at: Math.floor(Date.now() / 1000) + (expires_in || 3600),
  })

  consola.success(`Logged in as ${agentEmail} (agent)`)
}
