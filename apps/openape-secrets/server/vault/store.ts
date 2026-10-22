import type { Client, Transaction } from '@libsql/client'

export type Table = 'versions' | 'vaults' | 'credentials' | 'secrets' | 'requests' | 'approvals' | 'challenges' | 'consumers' | 'audit'
export interface RecordBase { id: string, owner: string }
const tables: Table[] = ['versions', 'vaults', 'credentials', 'secrets', 'requests', 'approvals', 'challenges', 'consumers', 'audit']
/** JSON holds versioned cryptographic envelopes; ownership and IDs are indexed columns. */
export class Records {
  constructor(readonly tx: Client | Transaction) {}
  async get<T extends RecordBase>(table: Table, id: string): Promise<T | null> {
    const result = await this.tx.execute({ sql: `SELECT payload FROM sv_${table} WHERE id = ?`, args: [id] })
    return result.rows[0] ? JSON.parse(String(result.rows[0].payload)) as T : null
  }

  async list<T extends RecordBase>(table: Table, owner: string): Promise<T[]> {
    const result = await this.tx.execute({ sql: `SELECT payload FROM sv_${table} WHERE owner = ? ORDER BY id`, args: [owner] })
    return result.rows.map(row => JSON.parse(String(row.payload)) as T)
  }

  async put<T extends RecordBase>(table: Table, row: T) {
    const result = await this.tx.execute({ sql: `INSERT INTO sv_${table} (id, owner, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE owner=excluded.owner`, args: [row.id, row.owner, JSON.stringify(row)] })
    if (result.rowsAffected !== 1) throw new Error('Owner mismatch')
  }

  async insert<T extends RecordBase>(table: Table, row: T) {
    await this.tx.execute({ sql: `INSERT INTO sv_${table} (id, owner, payload) VALUES (?, ?, ?)`, args: [row.id, row.owner, JSON.stringify(row)] })
  }
}
export class VaultStore extends Records {
  constructor(readonly client: Client) { super(client) }
  async initialize() {
    await this.client.execute('PRAGMA foreign_keys=ON')
    await this.client.batch(tables.flatMap(table => [
      `CREATE TABLE IF NOT EXISTS sv_${table} (id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)) CHECK(json_extract(payload, '$.id') = id AND json_extract(payload, '$.owner') = owner)${['vaults', 'challenges', 'audit'].includes(table) ? '' : ', FOREIGN KEY(owner) REFERENCES sv_vaults(id)'})`,
      `CREATE INDEX IF NOT EXISTS sv_${table}_owner ON sv_${table}(owner)`,
    ]).concat('CREATE UNIQUE INDEX IF NOT EXISTS sv_secrets_alias ON sv_secrets(owner, json_extract(payload, \'$.alias\')) WHERE json_extract(payload, \'$.deleted\') = 0'), 'write')
  }

  private tail: Promise<unknown> = Promise.resolve()
  async write<T>(fn: (records: Records) => Promise<T>): Promise<T> {
    const pending = this.tail.then(() => this.transaction(fn))
    this.tail = pending.catch(() => {})
    return pending
  }

  private async transaction<T>(fn: (records: Records) => Promise<T>): Promise<T> {
    const tx = await this.client.transaction('write')
    try {
      const result = await fn(new Records(tx))
      await tx.commit()
      return result
    }
    catch (err) { await tx.rollback(); throw err }
    finally { tx.close() }
  }
}
