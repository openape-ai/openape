import { materializeSecrets } from '@openape/apes'
import type { BridgeConfig } from './bridge-config'

export class AgentSession {
  constructor(
    readonly email: string,
    readonly ownerEmail: string,
    readonly config: BridgeConfig,
  ) {}

  describe(): string {
    return `${this.email} (owner ${this.ownerEmail})`
  }

  /**
   * Build this agent's troop chat WebSocket URL from its resolved endpoint and
   * a bearer token. Ports the exact derivation the per-agent bridge uses in
   * `pumpOnce` (http→ws, token carried as a query param, a leading `Bearer `
   * prefix stripped, the value URL-encoded) so the nest's in-process WS-open
   * increment connects to the same socket the bridge process opens today — with
   * no second copy of the URL rule once the nest drives the connection.
   */
  chatSocketUrl(bearer: string): string {
    const base = this.config.endpoint.replace(/^http/, 'ws')
    const token = encodeURIComponent(bearer.replace(/^Bearer\s+/i, ''))
    return `${base}/_ws/chat?token=${token}`
  }

  secretsEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    materializeSecrets({ env })
    return env
  }
}
