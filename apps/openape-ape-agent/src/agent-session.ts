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

  secretsEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    materializeSecrets({ env })
    return env
  }
}
