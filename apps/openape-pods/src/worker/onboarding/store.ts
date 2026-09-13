import type { ConnectionView } from '../../contracts/onboarding'
import type { PodDatabase } from '../storage/database'

export class OnboardingStore {
  constructor(private readonly store: PodDatabase) {
    store.db.prepare('UPDATE connections SET state=\'failed\',error=\'Sign-in was interrupted. Start a new sign-in to retry.\' WHERE state=\'connecting\'').run()
  }

  connections(): ConnectionView[] {
    return this.store.db.prepare('SELECT * FROM connections ORDER BY rowid').all().map(row => ({ id: row.id as string, provider: row.provider as ConnectionView['provider'], account: row.account as string, state: row.state as ConnectionView['state'], error: row.error as string | null, login: null }))
  }

  save(connection: Omit<ConnectionView, 'login'>, metadata: Record<string, unknown>): void {
    if (this.connections().length >= 100 && !this.store.db.prepare('SELECT 1 FROM connections WHERE id=?').get(connection.id)) throw new Error('Connection limit reached')
    this.store.db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account=excluded.account,state=excluded.state,error=excluded.error,metadata=excluded.metadata').run(connection.id, connection.provider, connection.account, connection.state, connection.error, JSON.stringify(metadata))
  }

  metadata(id: string): Record<string, unknown> {
    const row = this.store.db.prepare('SELECT metadata FROM connections WHERE id=?').get(id)
    if (!row) throw new Error('Connection not found')
    return JSON.parse(row.metadata as string) as Record<string, unknown>
  }

  complete(): boolean { return this.store.db.prepare('SELECT complete FROM onboarding WHERE id=1').get()!.complete === 1 }
  finish(): void { this.store.db.prepare('UPDATE onboarding SET complete=1 WHERE id=1').run() }
}
