import { readFileSync } from 'node:fs'
import { sign } from 'node:crypto'
import { getAgentAuthenticateEndpoint, getAgentChallengeEndpoint } from './discovery.js'

export interface AgentAuthState {
  idpUrl: string
  token: string
  email: string
  expiresAt: number
}

export async function authenticateAgent(options: {
  idpUrl: string
  email: string
  keyPath: string
}): Promise<AgentAuthState> {
  const { idpUrl, email, keyPath } = options

  // Load Ed25519 private key
  const keyContent = readFileSync(keyPath, 'utf-8')
  const privateKey = loadEd25519PrivateKey(keyContent)

  // Challenge
  const challengeUrl = await getAgentChallengeEndpoint(idpUrl)
  const challengeResp = await fetch(challengeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: email }),
  })

  if (!challengeResp.ok)
    throw new Error(`Agent challenge failed: ${challengeResp.status} ${await challengeResp.text()}`)

  const { challenge } = await challengeResp.json() as { challenge: string }

  // Sign
  const signature = sign(null, Buffer.from(challenge), privateKey).toString('base64')

  // Authenticate
  const authenticateUrl = await getAgentAuthenticateEndpoint(idpUrl)
  const authResp = await fetch(authenticateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: email, challenge, signature }),
  })

  if (!authResp.ok)
    throw new Error(`Agent authentication failed: ${authResp.status} ${await authResp.text()}`)

  const { token, expires_in } = await authResp.json() as { token: string, expires_in: number }

  return {
    idpUrl,
    token,
    email,
    expiresAt: Math.floor(Date.now() / 1000) + (expires_in || 3600),
  }
}

export function isTokenExpired(state: AgentAuthState): boolean {
  return Math.floor(Date.now() / 1000) > state.expiresAt - 30
}

function loadEd25519PrivateKey(content: string): string | Buffer {
  // PKCS8 PEM
  if (content.includes('BEGIN PRIVATE KEY'))
    return content

  // OpenSSH format — extract the raw key
  if (content.includes('BEGIN OPENSSH PRIVATE KEY'))
    return content

  throw new Error('Unsupported key format. Expected PKCS8 PEM or OpenSSH format.')
}
