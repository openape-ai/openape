import type { BridgeConfig } from './bridge'

export class AgentSession {
  constructor(
    readonly email: string,
    readonly ownerEmail: string,
    readonly config: BridgeConfig,
  ) {}

  describe(): string {
    return `${this.email} (owner ${this.ownerEmail})`
  }
}
