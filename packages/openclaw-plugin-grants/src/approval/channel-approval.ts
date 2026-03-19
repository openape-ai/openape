import type { PluginApi } from '../types.js'
import type { GrantRecord } from '../types.js'
import type { GrantStore } from '../store/grant-store.js'

const RISK_EMOJI: Record<string, string> = {
  low: '\u{1F7E2}',     // green circle
  medium: '\u{1F7E1}',  // yellow circle
  high: '\u{1F534}',    // red circle
  critical: '\u{26D4}', // no entry
}

export class ChannelApproval {
  private pending = new Map<string, {
    resolve: (result: { approved: boolean, approval?: 'once' | 'timed' | 'always' }) => void
    timeout: ReturnType<typeof setTimeout>
  }>()

  constructor(
    private api: PluginApi,
    private store: GrantStore,
    private timeoutMs: number = 300000,
  ) {
    this.registerCommands()
  }

  async requestApproval(grant: GrantRecord): Promise<{ approved: boolean, approval?: 'once' | 'timed' | 'always' }> {
    const emoji = RISK_EMOJI[grant.risk] ?? '\u{1F50D}'
    const message = [
      `\u{1F510} Grant Request ${emoji} [${grant.risk} risk]`,
      `Operation: ${grant.display}`,
      `Permission: ${grant.permission}`,
      grant.reason ? `Reason: ${grant.reason}` : '',
      `ID: ${grant.id}`,
      '',
      'Reply: /grant-approve <id> [once|1h|4h|always] or /grant-deny <id>',
    ].filter(Boolean).join('\n')

    await this.api.sendChannelMessage({
      text: message,
      actions: [
        { label: 'Once', value: `grant-approve ${grant.id} once` },
        { label: '1h', value: `grant-approve ${grant.id} 1h` },
        { label: '4h', value: `grant-approve ${grant.id} 4h` },
        { label: 'Always', value: `grant-approve ${grant.id} always` },
        { label: 'Deny', value: `grant-deny ${grant.id}` },
      ],
    })

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(grant.id)
        resolve({ approved: false })
      }, this.timeoutMs)

      this.pending.set(grant.id, { resolve, timeout })
    })
  }

  private registerCommands(): void {
    this.api.onChannelCommand('grant-approve', async (args: string[]) => {
      const [id, durationOrType] = args
      if (!id)
        return

      let approval: 'once' | 'timed' | 'always' = 'once'
      let expiresAt: string | undefined

      if (durationOrType === 'always') {
        approval = 'always'
      }
      else if (durationOrType === '1h' || durationOrType === '4h') {
        approval = 'timed'
        const hours = durationOrType === '1h' ? 1 : 4
        expiresAt = new Date(Date.now() + hours * 3600_000).toISOString()
      }
      else if (durationOrType === 'once' || !durationOrType) {
        approval = 'once'
      }

      const grant = this.store.approveGrant(id, approval, expiresAt)
      if (!grant) {
        this.api.logger.warn(`[grants] Cannot approve grant ${id}: not found or not pending`)
        return
      }

      const pending = this.pending.get(id)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pending.delete(id)
        pending.resolve({ approved: true, approval })
      }
    })

    this.api.onChannelCommand('grant-deny', async (args: string[]) => {
      const [id] = args
      if (!id)
        return

      this.store.denyGrant(id)

      const pending = this.pending.get(id)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pending.delete(id)
        pending.resolve({ approved: false })
      }
    })
  }
}
