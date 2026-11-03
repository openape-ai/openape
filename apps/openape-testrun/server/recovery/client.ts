import type { Client, InArgs, InStatement, ResultSet, Transaction, TransactionMode } from '@libsql/client'
import type { EncodedStatement, RecoverySession } from './types'
import { authorityFingerprint } from './fingerprint'
import { recoveryUnavailable } from './errors'
import { encodeStatement, isReadStatement } from './encoding'
import { commitRecord, readLocalState, reconcileDatabase } from './state'

interface Connection { original: Client, session?: RecoverySession, pending?: Promise<void> }
const connections = new WeakMap<Client, Connection>()
function assertAvailable(connection: Connection) { if (connection.session?.failure) throw connection.session.failure }
export function requireRecoveryAvailable(client: Client) {
  const connection = connections.get(client)
  if (connection) assertAvailable(connection)
}
export function recoveryFailure(client: Client) { return connections.get(client)?.session?.failure }
function bind<T extends object>(target: T, property: string | symbol) {
  const value: unknown = Reflect.get(target, property, target)
  return typeof value === 'function' ? value.bind(target) : value
}
async function acquire(connection: Connection) {
  const previous = connection.pending
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  connection.pending = pending
  await previous
  return () => { release(); if (connection.pending === pending) connection.pending = undefined }
}
function inputStatement(statement: InStatement, args?: InArgs): InStatement {
  return typeof statement === 'string' && args !== undefined ? { sql: statement, args } : statement
}
function assertRecoverable(statement: InStatement) {
  const sql = typeof statement === 'string' ? statement : statement.sql
  if (!/^\s*(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) throw new Error('Recovery-enabled writes require explicit deterministic DML transactions')
  if (!isReadStatement(statement) && /\b(?:random|randomblob|last_insert_rowid|changes|total_changes|CURRENT_TIME|CURRENT_TIMESTAMP|CURRENT_DATE)\b|\b(?:date|time|datetime|julianday|unixepoch|strftime)\s*\(/i.test(sql)) throw new Error('Recovery requires binding generated identities and timestamps as SQL arguments')
}
async function begin(connection: Connection, mode?: TransactionMode): Promise<Transaction> {
  const release = await acquire(connection)
  try { assertAvailable(connection) }
  catch (error) { release(); throw error }
  let transaction: Transaction
  try { transaction = await connection.original.transaction(mode) }
  catch (error) { release(); throw error }
  const statements: EncodedStatement[] = []
  const session = connection.session
  if (!session) { transaction.close(); release(); throw new Error('Recovery session disappeared before transaction startup') }
  try {
    if (await authorityFingerprint(transaction) !== session.head.fingerprint) throw new Error('Unjournaled state or schema differs from the recovery authority')
  }
  catch (cause) {
    session.failure = recoveryUnavailable('transaction-start', 'unjournaled-state', cause)
    try { transaction.close() }
    finally { release() }
    throw session.failure
  }
  let failed = false
  async function execute(input: InStatement, args?: InArgs): Promise<ResultSet> {
    try {
      if (failed) throw new Error('A failed recovery transaction must be rolled back')
      assertAvailable(connection)
      const statement = inputStatement(input, args)
      assertRecoverable(statement)
      if (mode === 'read' && !isReadStatement(statement)) throw new Error('A recovery read transaction cannot write')
      const encoded = encodeStatement(statement)
      const result = await transaction.execute(statement)
      if (!isReadStatement(statement)) statements.push(encoded)
      return result
    }
    catch (error) { failed = true; throw error }
  }
  return {
    execute,
    async batch(input) {
      const results: ResultSet[] = []
      for (const statement of input) results.push(await execute(statement))
      return results
    },
    async executeMultiple() { failed = true; throw new Error('Recovery transactions require separately parameterized statements') },
    async commit() {
      try {
        assertAvailable(connection)
        if (failed) throw new Error('A failed recovery transaction must be rolled back')
        if (!statements.length) { await transaction.commit(); return }
        try { await commitRecord(session, transaction, statements) }
        catch (cause) {
          session.failure = recoveryUnavailable('independent-commit', 'commit-outcome-unconfirmed', cause)
          throw session.failure
        }
      }
      finally {
        try { transaction.close() }
        finally { release() }
      }
    },
    async rollback() {
      try { if (!transaction.closed) await transaction.rollback() }
      finally {
        try { transaction.close() }
        finally { release() }
      }
    },
    close() {
      try { transaction.close() }
      finally { release() }
    },
    get closed() { return transaction.closed },
  }
}
export function createRecoveryClient(original: Client): Client {
  const connection: Connection = { original }
  const client = new Proxy(original, {
    get(target, property) {
      if (property === 'transaction') return (mode?: TransactionMode) => connection.session ? begin(connection, mode) : original.transaction(mode)
      if (property === 'execute') {
        return async (input: InStatement, args?: InArgs) => {
          const statement = inputStatement(input, args)
          assertAvailable(connection)
          if (connection.session && !isReadStatement(statement)) throw new Error('Reports mutation requires a recoverable transaction')
          return original.execute(statement)
        }
      }
      if (['batch', 'migrate', 'executeMultiple', 'sync'].includes(String(property)) && connection.session) return () => { throw new Error('Reports mutation requires a recoverable transaction') }
      return bind(target, property)
    },
  })
  connections.set(client, connection)
  return client
}
export async function enableRecovery(client: Client, configuration: Pick<RecoverySession, 'store' | 'key'>) {
  const connection = connections.get(client)
  if (!connection) throw new Error('Recovery requires the wrapped Reports database client')
  if (connection.session) throw new Error('Reports recovery is already enabled')
  const result = await reconcileDatabase(connection.original, configuration.store, configuration.key)
  connection.session = { ...configuration, head: result.head, etag: result.etag }
  return result
}
export async function assertRecoveryConfigured(client: Client) {
  if (await readLocalState(client)) throw new Error('Reports database requires independent recovery configuration; disabling it is not a rollback')
}
