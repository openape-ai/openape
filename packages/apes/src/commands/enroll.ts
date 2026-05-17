import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { sign } from 'node:crypto'
import { defineCommand } from 'citty'
import consola from 'consola'
import { loadEd25519PrivateKey } from '../ssh-key'
import { generateAndSaveKey, readPublicKey, resolveKeyPath } from '../lib/keygen'
import { getAgentAuthenticateEndpoint, getAgentChallengeEndpoint } from '../http'
import { loadConfig, saveAuth, saveConfig } from '../config'
import { CliError, CliExit } from '../errors'

const DEFAULT_IDP_URL = 'https://id.openape.at'
const DEFAULT_KEY_PATH = '~/.ssh/id_ed25519'
const POLL_INTERVAL = 3000
const POLL_TIMEOUT = 300_000 // 5 minutes

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  execFile(cmd, [url], () => {})
}

async function pollForEnrollment(
  idp: string,
  agentEmail: string,
  keyPath: string,
): Promise<{ token: string, expiresIn: number }> {
  const resolvedKey = resolveKeyPath(keyPath)
  const keyContent = readFileSync(resolvedKey, 'utf-8')
  const privateKey = loadEd25519PrivateKey(keyContent)

  const challengeUrl = await getAgentChallengeEndpoint(idp)
  const authenticateUrl = await getAgentAuthenticateEndpoint(idp)
  const startTime = Date.now()

  while (Date.now() - startTime < POLL_TIMEOUT) {
    try {
      // Try to get a challenge — if it works, agent is enrolled
      const challengeResp = await fetch(challengeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentEmail }),
      })

      if (challengeResp.ok) {
        const { challenge } = await challengeResp.json() as { challenge: string }
        const signature = sign(null, Buffer.from(challenge), privateKey).toString('base64')

        const authResp = await fetch(authenticateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentEmail, challenge, signature }),
        })

        if (authResp.ok) {
          const result = await authResp.json() as { token: string, expires_in: number }
          return { token: result.token, expiresIn: result.expires_in }
        }
      }
    }
    catch {
      // Ignore network errors during polling
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
  }

  throw new Error('Enrollment timed out. Please check the browser and try again.')
}

export const enrollCommand = defineCommand({
  meta: {
    name: 'enroll',
    description: 'Enroll an agent with an Identity Provider',
  },
  args: {
    idp: {
      type: 'string',
      description: `IdP URL (default: ${DEFAULT_IDP_URL})`,
    },
    name: {
      type: 'string',
      description: 'Agent name',
    },
    key: {
      type: 'string',
      description: `Path to Ed25519 key (default: ${DEFAULT_KEY_PATH})`,
    },
  },
  async run({ args }) {
    // 1. Gather inputs
    const idp = args.idp
      || await consola.prompt('IdP URL', { type: 'text', default: DEFAULT_IDP_URL, placeholder: DEFAULT_IDP_URL }).then((r) => { if (typeof r === 'symbol') throw new CliExit(0); return r }) as string
      || DEFAULT_IDP_URL

    const agentName = args.name
      || await consola.prompt('Agent name', { type: 'text', placeholder: 'deploy-bot' }).then((r) => { if (typeof r === 'symbol') throw new CliExit(0); return r }) as string

    if (!agentName) {
      throw new CliError('Agent name is required.')
    }

    const keyPath = args.key
      || await consola.prompt('Ed25519 key', { type: 'text', default: DEFAULT_KEY_PATH, placeholder: DEFAULT_KEY_PATH }).then((r) => { if (typeof r === 'symbol') throw new CliExit(0); return r }) as string
      || DEFAULT_KEY_PATH

    // 2. Handle key
    const resolvedKey = resolveKeyPath(keyPath)
    let publicKey: string

    if (existsSync(resolvedKey)) {
      publicKey = readPublicKey(resolvedKey)
      consola.success(`Using existing key ${keyPath}`)
    }
    else {
      consola.start(`Generating Ed25519 key pair at ${keyPath}...`)
      publicKey = generateAndSaveKey(keyPath)
      consola.success(`Key pair generated at ${keyPath}`)
    }

    // 3. Open browser for enrollment
    const encodedKey = encodeURIComponent(publicKey)
    const enrollUrl = `${idp}/enroll?name=${encodeURIComponent(agentName)}&key=${encodedKey}`

    consola.info('Opening browser for enrollment...')
    consola.info(`→ ${idp}/enroll`)
    openBrowser(enrollUrl)

    // 4. Determine expected agent email
    // For the free IdP, the email format is: {name}+{user_local}+{user_domain}@id.openape.at
    // For custom IdPs, the format varies. We'll try common patterns.
    // The polling will try the challenge endpoint which accepts email as agent_id.
    // We need to guess the email, or poll without knowing it.
    // Best approach: ask the user to confirm the email shown in browser.
    console.log('')
    const agentEmail = await consola.prompt(
      'Agent email (shown in browser after enrollment)',
      { type: 'text', placeholder: `agent+${agentName}@...` },
    ).then((r) => { if (typeof r === 'symbol') throw new CliExit(0); return r }) as string

    if (!agentEmail) {
      throw new CliError('Agent email is required to verify enrollment.')
    }

    // 5. Poll for enrollment confirmation via challenge endpoint
    consola.start('Verifying enrollment...')
    const { token, expiresIn } = await pollForEnrollment(idp, agentEmail, keyPath)

    // 6. Save auth + config
    saveAuth({
      idp,
      access_token: token,
      email: agentEmail,
      expires_at: Math.floor(Date.now() / 1000) + (expiresIn || 3600),
    })

    const config = loadConfig()
    config.defaults = { ...config.defaults, idp }
    config.agent = { key: keyPath, email: agentEmail }
    saveConfig(config)

    consola.success(`Agent enrolled as ${agentEmail}`)
    consola.success('Config saved to ~/.config/apes/')

    console.log('')
    consola.info('Verify with: apes whoami')
  },
})
