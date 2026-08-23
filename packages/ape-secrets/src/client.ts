/**
 * Shared SP client for secrets.openape.ai. Auth (login, refresh, RFC 8693
 * exchange) comes from @openape/cli-auth — one `apes login` on the device
 * covers this CLI like every other OpenApe one.
 */
import type { SpClientState } from '@openape/cli-auth'
import { createProofClient } from '@openape/proof-cli'

export interface SecretsState extends SpClientState {
  endpoint?: string
}

export const secretsClient = createProofClient<SecretsState>({
  endpoint: 'https://secrets.openape.ai',
  envVar: 'APE_SECRETS_ENDPOINT',
  configFile: 'auth-secrets.json',
  aud: 'secrets.openape.ai',
})

export const { resolveEndpoint, loadConfig, saveConfig, _request } = secretsClient
