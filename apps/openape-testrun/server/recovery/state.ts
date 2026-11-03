import type { Client, Transaction } from '@libsql/client'
import type { LocalRecoveryState, ObjectStore, RecoveryCheckpoint, RecoveryHead, RecoveryRecord, RecoveryRef, RecoverySession } from './types'
import { randomUUID } from 'node:crypto'
import { decodeStatement, digest, seal, unseal } from './encoding'
import { authorityFingerprint } from './fingerprint'
import { parseHead, parseRecord, reference, sameReference } from './validation'

type Database = Pick<Client, 'execute'> | Transaction
export async function readLocalState(db: Database): Promise<LocalRecoveryState | null> {
  const table = await db.execute('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'reports_recovery_state\'')
  if (!table.rows.length) return null
  const row = (await db.execute('SELECT instance,sequence,tip FROM reports_recovery_state WHERE id=1')).rows[0]
  if (!row || typeof row.instance !== 'string' || !Number.isSafeInteger(Number(row.sequence)) || Number(row.sequence) < 0) throw new Error('Invalid local Reports recovery state')
  return { instance: row.instance, sequence: Number(row.sequence), tip: row.tip === null ? null : reference(JSON.parse(String(row.tip))) }
}
export async function prepareLocalState(client: Client) {
  if (await readLocalState(client)) throw new Error('Reports recovery is already prepared; inspect or recover it instead')
  const instance = (await client.execute('SELECT instance_id FROM html_policy_state WHERE id=1')).rows[0]?.instance_id
  if (typeof instance !== 'string' || !/^[a-f0-9]{32}$/.test(instance)) throw new Error('Reports database identity is missing')
  const tx = await client.transaction('write')
  try {
    await tx.execute('CREATE TABLE reports_recovery_state (id INTEGER PRIMARY KEY CHECK(id=1),instance TEXT NOT NULL,sequence INTEGER NOT NULL,tip TEXT)')
    await tx.execute({ sql: 'INSERT INTO reports_recovery_state VALUES (1,?,0,NULL)', args: [instance] })
    await tx.commit()
  }
  catch (error) { if (!tx.closed) await tx.rollback(); throw error }
  finally { tx.close() }
  return instance
}
export async function persistLocalState(db: Database, state: LocalRecoveryState) {
  const result = await db.execute({ sql: 'UPDATE reports_recovery_state SET sequence=?,tip=? WHERE id=1 AND instance=?', args: [state.sequence, state.tip === null ? null : JSON.stringify(state.tip), state.instance] })
  if (result.rowsAffected !== 1) throw new Error('Reports recovery state changed unexpectedly')
}
export async function readHead(store: ObjectStore, key: Uint8Array) {
  const remote = await store.get('head')
  if (!remote) throw new Error('Reports recovery authority is missing; explicit bootstrap is required')
  return { head: parseHead(unseal(remote.bytes, key)), etag: remote.etag }
}
export async function bootstrapAuthority(client: Client, store: ObjectStore, key: Uint8Array, checkpoint: Omit<RecoveryCheckpoint, 'fingerprint'>) {
  const local = await readLocalState(client)
  if (!local || local.sequence !== 0 || local.tip !== null) throw new Error('Bootstrap requires a prepared sequence-zero database and verified off-host checkpoint')
  const fingerprint = await authorityFingerprint(client)
  const head = parseHead({ schema: 1, ...local, checkpoint: { ...checkpoint, fingerprint }, fingerprint })
  const etag = await store.put('head', seal(head, key), null)
  return { head, etag }
}
export async function advanceCheckpoint(client: Client, store: ObjectStore, key: Uint8Array, checkpoint: Omit<RecoveryCheckpoint, 'fingerprint'>) {
  const local = await readLocalState(client)
  const current = await readHead(store, key)
  const fingerprint = await authorityFingerprint(client)
  if (!local || local.instance !== current.head.instance || local.sequence !== current.head.sequence || !sameReference(local.tip, current.head.tip) || fingerprint !== current.head.fingerprint) throw new Error('Checkpoint rotation requires the complete current authority and a fenced writer')
  const head = { ...current.head, checkpoint: { ...checkpoint, fingerprint } }
  const etag = await store.put('head', seal(head, key), current.etag)
  return { head, etag }
}
export async function commitRecord(session: RecoverySession, tx: Transaction, statements: RecoveryRecord['statements']) {
  if (session.failure) throw session.failure
  const local = await readLocalState(tx)
  if (!local || local.instance !== session.head.instance || local.sequence !== session.head.sequence || !sameReference(local.tip, session.head.tip)) throw new Error('Local Reports state differs from the recovery authority')
  const sequence = session.head.sequence + 1
  if (!Number.isSafeInteger(sequence)) throw new Error('Recovery sequence exhausted')
  const fingerprint = await authorityFingerprint(tx)
  const record: RecoveryRecord = { schema: 1, instance: local.instance, sequence, previous: session.head.tip, statements, fingerprint }
  const bytes = seal(record, session.key)
  const tip: RecoveryRef = { key: `records/${sequence}-${randomUUID()}`, digest: digest(bytes) }
  await session.store.put(tip.key, bytes, null)
  const head: RecoveryHead = { ...session.head, sequence, tip, fingerprint }
  const etag = await session.store.put('head', seal(head, session.key), session.etag)
  await persistLocalState(tx, head)
  await tx.commit()
  session.head = head
  session.etag = etag
}
export async function reconcileDatabase(client: Client, store: ObjectStore, key: Uint8Array) {
  const local = await readLocalState(client)
  const current = await readHead(store, key)
  if (!local || local.instance !== current.head.instance || local.sequence > current.head.sequence) throw new Error('Reports database cannot be reconciled with this recovery authority')
  const records: Array<{ sequence: number, tip: RecoveryRef }> = []
  let tip = current.head.tip
  let sequence = current.head.sequence
  while (sequence > local.sequence) {
    if (!tip) throw new Error('Reports recovery chain has a gap')
    const object = await store.get(tip.key)
    if (!object || digest(object.bytes) !== tip.digest) throw new Error('Reports recovery record is missing or changed')
    const record = parseRecord(unseal(object.bytes, key))
    if (record.instance !== local.instance || record.sequence !== sequence) throw new Error('Reports recovery chain identity or sequence differs')
    records.push({ sequence, tip })
    tip = record.previous
    sequence--
  }
  if (!sameReference(tip, local.tip)) throw new Error('Reports recovery checkpoint does not belong to the committed chain')
  let expectedFingerprint = current.head.checkpoint.fingerprint
  if (local.tip) {
    const previous = await store.get(local.tip.key)
    if (!previous || digest(previous.bytes) !== local.tip.digest) throw new Error('Recovery checkpoint record is missing or changed')
    expectedFingerprint = parseRecord(unseal(previous.bytes, key)).fingerprint
  }
  if (await authorityFingerprint(client) !== expectedFingerprint) throw new Error('Reports checkpoint contains unjournaled state or a different schema')
  for (const entry of records.reverse()) {
    const object = await store.get(entry.tip.key)
    if (!object || digest(object.bytes) !== entry.tip.digest) throw new Error('Reports recovery record changed before replay')
    const record = parseRecord(unseal(object.bytes, key))
    const tx = await client.transaction('write')
    try {
      for (const statement of record.statements) await tx.execute(decodeStatement(statement))
      if (await authorityFingerprint(tx) !== record.fingerprint) throw new Error('Replayed Reports state differs from the committed transaction')
      await persistLocalState(tx, { instance: local.instance, sequence: entry.sequence, tip: entry.tip })
      await tx.commit()
    }
    catch (error) { if (!tx.closed) await tx.rollback(); throw error }
    finally { tx.close() }
  }
  if (await authorityFingerprint(client) !== current.head.fingerprint) throw new Error('Recovered Reports state does not match the authority')
  const latest = await readHead(store, key)
  if (latest.etag !== current.etag) throw new Error('Recovery authority changed during replay; fence the other writer before serving')
  return { ...current, replayed: records.length }
}
