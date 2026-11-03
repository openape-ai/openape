import type { Client, Transaction } from '@libsql/client'
import type { ObjectStore, ObjectValue } from '../server/recovery/types'
import { createClient } from '@libsql/client'
import { mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateReports } from '../server/database/migrate'
import { advanceCheckpoint, bootstrapAuthority, prepareLocalState, readLocalState, reconcileDatabase } from '../server/recovery/state'
import { assertRecoveryConfigured, createRecoveryClient, enableRecovery, recoveryFailure } from '../server/recovery/client'
import { digest, seal, unseal } from '../server/recovery/encoding'
import { initializeHtmlPolicyJournal, persistAuthoritativePolicyJournal } from '../server/utils/html-policy-journal'
import { manageHtml, publishHtml, purgeHtml, readHtml, transaction } from '../server/utils/html-store'
import { inspectHtml } from '../shared/html-publication'
import { acceptPlanInvite, mutateTeam } from '../server/utils/plans-teams'
import { createReportSeries } from '../server/utils/report-store'
import { publishDocument } from '../server/utils/document-store'
import { validateDocument } from '../server/utils/document-shape'
import { drizzle } from 'drizzle-orm/libsql'
import { runs } from '../server/database/schema'

class MemoryStore implements ObjectStore {
  objects = new Map<string, ObjectValue>()
  failHead: 'before' | 'after' | undefined
  async get(key: string) { const v = this.objects.get(key); return v ? { ...v, bytes: v.bytes.slice() } : null }
  async put(key: string, bytes: Uint8Array, expected: string | null) {
    if (key === 'head' && this.failHead === 'before') throw new Error('Synthetic authority outage')
    const previous = this.objects.get(key)
    if (expected === null ? previous !== undefined : previous?.etag !== expected) throw new Error('Conditional write failed: HTTP 412')
    const etag = digest(bytes)
    this.objects.set(key, { bytes: bytes.slice(), etag })
    if (key === 'head' && this.failHead === 'after') throw new Error('Synthetic lost response after durable commit')
    return etag
  }
}
const owner = { subject: 'owner@example.test', actor: 'owner@example.test' }
const html = '<!doctype html><html><head><title>Recovery</title></head><body>confidential marker</body></html>'
const base = 'https://reports.example.test'
let directory: string
let clients: Client[]
let raw: Client
let client: Client
let store: MemoryStore
let key: Uint8Array
let checkpoint: string
let failLocalCommit: boolean
function tracked(path: string) { const c = createClient({ url: `file:${path}` }); clients.push(c); return c }
async function publish(c = client, idempotencyKey = 'first') {
  const input = { publication: inspectHtml(html), audience: { mode: 'public' } }
  return publishHtml(c, input, JSON.stringify(input), owner, idempotencyKey, base)
}
async function recovered(name = 'recovered.db') {
  const path = join(directory, name)
  copyFileSync(checkpoint, path)
  const c = createRecoveryClient(tracked(path))
  await enableRecovery(c, { store, key })
  await persistAuthoritativePolicyJournal(c, `${path}.policies.json`)
  await initializeHtmlPolicyJournal(c, `${path}.policies.json`)
  return c
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'reports-recovery-'))
  clients = []; store = new MemoryStore(); key = randomBytes(32); failLocalCommit = false
  raw = tracked(join(directory, 'live.db'))
  const injectable = new Proxy(raw, {
    get(target, property) {
      if (property === 'transaction') {
        return async (...args: Parameters<Client['transaction']>) => {
          const tx = await target.transaction(...args)
          return new Proxy(tx, {
            get(transaction, member) {
              if (member === 'commit') return async () => { if (failLocalCommit) throw new Error('Synthetic local commit failure'); await transaction.commit() }
              const value: unknown = Reflect.get(transaction, member, transaction)
              return typeof value === 'function' ? value.bind(transaction) : value
            },
          }) as Transaction
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  client = createRecoveryClient(injectable)
  await migrateReports(client)
  await initializeHtmlPolicyJournal(client, join(directory, 'live.policies.json'))
  await prepareLocalState(client)
  checkpoint = join(directory, 'checkpoint.db')
  await client.execute({ sql: 'VACUUM INTO ?', args: [checkpoint] })
  await bootstrapAuthority(client, store, key, { snapshot: '0'.repeat(64), path: '/state/reports.db', digest: digest(readFileSync(checkpoint)) })
  await enableRecovery(client, { store, key })
})
afterEach(() => { for (const c of clients) c.close(); rmSync(directory, { recursive: true, force: true }) })

describe('independent Reports recovery authority', () => {
  it('advances a verified checkpoint without deleting history and recovers subsequent writes', async () => {
    await publish()
    const count = store.objects.size
    checkpoint = join(directory, 'advanced.db')
    await raw.execute({ sql: 'VACUUM INTO ?', args: [checkpoint] })
    const independent = tracked(checkpoint)
    await advanceCheckpoint(independent, store, key, { snapshot: '1'.repeat(64), path: '/state/advanced.db', digest: digest(readFileSync(checkpoint)) })
    expect(store.objects.size).toBe(count)
    raw.close()
    const next = await recovered('next.db')
    expect((await readLocalState(next))?.sequence).toBe(1)
    await publish(next, 'after-checkpoint')
    const final = await recovered('final.db')
    expect((await final.execute('SELECT COUNT(*) AS count FROM html_documents')).rows[0]?.count).toBe(2)
  })

  it('does not append recovery transactions when retention has nothing to purge', async () => {
    expect(await purgeHtml(client)).toBe(0)
    expect((await readLocalState(client))?.sequence).toBe(0)
    expect(store.objects.size).toBe(1)
  })

  it('refuses unjournaled permission changes before accepting another write', async () => {
    const first = await publish()
    await raw.execute({ sql: 'UPDATE html_documents SET owner=? WHERE id=?', args: ['unexpected@example.test', String(first.document_id)] })
    await expect(publish(client, 'after-drift')).rejects.toMatchObject({ statusCode: 503, data: { phase: 'transaction-start', cause: 'unjournaled-state' } })
    await expect(client.execute('SELECT * FROM html_documents')).rejects.toThrow('fenced')
    const restored = await recovered()
    expect((await readHtml(restored, String(first.document_id), owner)).document.owner).toBe(owner.subject)
    expect((await readLocalState(restored))?.sequence).toBe(1)
  })

  it('poisons partial batches and guard failures, rolls back on commit, and releases the next writer', async () => {
    const tx = await client.transaction('write')
    await tx.execute('UPDATE html_policy_state SET revision=? WHERE id=1', [10])
    await expect(tx.batch(['UPDATE html_policy_state SET revision=11 WHERE id=1', 'UPDATE absent_table SET value=1'])).rejects.toThrow()
    await expect(tx.commit()).rejects.toThrow('must be rolled back')
    expect(tx.closed).toBe(true)
    const guarded = await client.transaction('write')
    await guarded.execute('UPDATE html_policy_state SET revision=12 WHERE id=1')
    await expect(guarded.execute('PRAGMA user_version=2')).rejects.toThrow('deterministic DML')
    await expect(guarded.commit()).rejects.toThrow('must be rolled back')
    expect((await readLocalState(client))?.sequence).toBe(0)
    expect((await client.execute('SELECT revision FROM html_policy_state WHERE id=?', [1])).rows[0]?.revision).not.toBe(12)
    await publish()
    expect((await readLocalState(client))?.sequence).toBe(1)
  })

  it('recovers team-member and publisher revocations with immutable schema-one documents', async () => {
    const secret = 'synthetic-recovery-invite-secret-at-least-32-characters'
    const member = { subject: 'member@example.test', actor: 'member@example.test' }
    const team = await mutateTeam(client, owner, 'POST', [], { name: 'Recovery' }, false, secret, base)
    const teamId = String(team.id)
    const invite = await mutateTeam(client, owner, 'POST', [teamId, 'invites'], {}, false, secret, base)
    await acceptPlanInvite(client, String(invite.token), secret, member)
    const input = { publication: inspectHtml(html), audience: { mode: 'team', teamId } }
    const published = await publishHtml(client, input, JSON.stringify(input), owner, 'team-report', base)
    await readHtml(client, String(published.document_id), member)
    await mutateTeam(client, owner, 'DELETE', [teamId, 'members', member.subject], {}, false, secret, base)
    const series = await createReportSeries(client, owner.subject, 'Recovery editions')
    await transaction(client, async (tx) => { await tx.execute({ sql: 'UPDATE report_series SET publisher=? WHERE id=?', args: [member.subject, series.id!] }) })
    const document = validateDocument({ type: 'document', schemaVersion: 1, title: 'Recovery', html: '<h1>Immutable edition</h1>', seriesId: series.id })
    await publishDocument(client, document, JSON.stringify(document), owner.subject, member.subject, 'edition')
    await transaction(client, async (tx) => { await tx.execute({ sql: 'UPDATE report_series SET publisher=NULL,revision=revision+1 WHERE id=?', args: [series.id!] }) })
    raw.close()
    const restored = await recovered()
    await expect(readHtml(restored, String(published.document_id), member)).rejects.toMatchObject({ status: 404 })
    await expect(publishDocument(restored, document, JSON.stringify(document), owner.subject, member.subject, 'revoked')).rejects.toMatchObject({ statusCode: 404 })
    expect((await restored.execute('SELECT artifact FROM document_publications')).rows[0]?.artifact).toContain('Immutable edition')
  })

  it('journals Drizzle legacy-run transactions and preserves rollback failures as 503', async () => {
    const db = drizzle(client)
    await db.transaction(async (tx) => { await tx.insert(runs).values({ id: 'legacy', slug: 'legacy', title: 'Legacy run', manifest: '{}', createdBy: owner.subject, createdAt: 1 }) })
    const restored = await recovered()
    expect((await restored.execute('SELECT id FROM runs')).rows[0]?.id).toBe('legacy')
    store.failHead = 'before'
    await expect(db.transaction(async (tx) => { await tx.update(runs).set({ deletedAt: 2 }) })).rejects.toMatchObject({ statusCode: 503, data: { phase: 'independent-commit' } })
    expect((await raw.execute('SELECT deleted_at FROM runs')).rows[0]?.deleted_at).toBe(null)
  })

  it('recovers newer immutable content and revocation from an older checkpoint without the source', async () => {
    const first = await publish()
    const id = String(first.document_id)
    const changed = { documentId: id, expectedVersion: 1, publication: inspectHtml(html.replace('confidential marker', 'new immutable content')) }
    await publishHtml(client, changed, JSON.stringify(changed), owner, 'update', base)
    await manageHtml(client, id, owner, 'access', { audience: { mode: 'private' }, expectedAccessRevision: 1 })
    raw.close()
    const restored = await recovered()
    await expect(readHtml(restored, id, null)).rejects.toMatchObject({ status: 404 })
    expect((await readHtml(restored, id, owner)).version.html).toContain('new immutable content')
    const replay = await publish(restored)
    expect(replay).toMatchObject({ document_id: id, replayed: true })
    expect((await restored.execute('SELECT COUNT(*) AS count FROM html_documents')).rows[0]?.count).toBe(1)
    expect((await restored.execute('SELECT COUNT(*) AS count FROM html_versions')).rows[0]?.count).toBe(2)
    expect([...store.objects.values()].some(v => Buffer.from(v.bytes).includes('confidential marker'))).toBe(false)
  })

  it('fences an ambiguous remote commit and recovers the committed operation exactly once', async () => {
    store.failHead = 'after'
    await expect(publish()).rejects.toThrow('independent commit failed')
    expect(recoveryFailure(client)).toBeInstanceOf(Error)
    await expect(client.execute('SELECT * FROM html_documents')).rejects.toThrow('fenced')
    expect((await raw.execute('SELECT COUNT(*) AS count FROM html_documents')).rows[0]?.count).toBe(0)
    store.failHead = undefined
    const restored = await recovered()
    const retry = await publish(restored)
    expect(retry.replayed).toBe(true)
    expect((await restored.execute('SELECT COUNT(*) AS count FROM html_documents')).rows[0]?.count).toBe(1)
  })

  it('rolls back locally and keeps source reads fenced when independent persistence fails', async () => {
    store.failHead = 'before'
    await expect(publish()).rejects.toThrow('independent commit failed')
    expect((await raw.execute('SELECT COUNT(*) AS count FROM html_documents')).rows[0]?.count).toBe(0)
    store.failHead = undefined
    const restored = await recovered()
    expect((await readLocalState(restored))?.sequence).toBe(0)
    expect((await restored.execute('SELECT COUNT(*) AS count FROM html_documents')).rows[0]?.count).toBe(0)
  })

  it('recovers an external commit after local commit failure', async () => {
    failLocalCommit = true
    await expect(publish()).rejects.toThrow('independent commit failed')
    failLocalCommit = false
    expect((await raw.execute('SELECT COUNT(*) AS count FROM html_documents')).rows[0]?.count).toBe(0)
    const restored = await recovered()
    expect((await restored.execute('SELECT COUNT(*) AS count FROM html_documents')).rows[0]?.count).toBe(1)
  })

  it('rejects a stale second writer and replays only the winning committed chain', async () => {
    const second = await recovered('second-writer.db')
    await publish(client, 'winner')
    await expect(publish(second, 'stale')).rejects.toThrow('independent commit failed')
    expect(recoveryFailure(second)).toBeInstanceOf(Error)
    const restored = await recovered('after-conflict.db')
    expect((await restored.execute('SELECT key FROM html_receipts')).rows.map(row => row.key)).toEqual(['winner'])
  })

  it('refuses missing or corrupted records, a missing head, and a wrong recovery key', async () => {
    await publish()
    const record = [...store.objects.entries()].find(([name]) => name.startsWith('records/'))!
    const corrupted = record[1].bytes.slice(); corrupted[20] ^= 1
    store.objects.set(record[0], { ...record[1], bytes: corrupted })
    await expect(recovered('tampered.db')).rejects.toThrow('missing or changed')
    store.objects.delete(record[0])
    await expect(recovered('missing-record.db')).rejects.toThrow('missing or changed')
    await expect(reconcileDatabase(raw, store, randomBytes(32))).rejects.toThrow()
    store.objects.delete('head')
    await expect(recovered('missing-head.db')).rejects.toThrow('authority is missing')
  })

  it('does not allow disabling authority on a prepared database or bypassing the transaction boundary', async () => {
    await expect(assertRecoveryConfigured(client)).rejects.toThrow('requires independent recovery')
    await expect(client.execute('DELETE FROM html_documents')).rejects.toThrow('recoverable transaction')
    const tx = await client.transaction('read')
    await expect(tx.execute('DELETE FROM html_documents')).rejects.toThrow('cannot write')
    await tx.rollback(); tx.close()
    expect((await readLocalState(client))?.sequence).toBe(0)
  })

  it('round-trips binary SQL arguments and rejects nondeterministic writes before commit', async () => {
    const bytes = randomBytes(128)
    const tx = await client.transaction('write')
    await tx.execute({ sql: 'INSERT INTO assets (id,run_id,path,content_type,size,bytes,created_at,version) VALUES (?,?,?,?,?,?,?,?)', args: ['asset', 'fixture', 'a.png', 'image/png', bytes.length, bytes, 1, 1] })
    await tx.commit(); tx.close()
    const restored = await recovered()
    const row = (await restored.execute('SELECT bytes FROM assets WHERE id=\'asset\'')).rows[0]!
    expect(Buffer.from(row.bytes as ArrayBuffer)).toEqual(bytes)
    const unsafe = await client.transaction('write')
    await expect(unsafe.execute('UPDATE assets SET created_at=unixepoch(\'now\')')).rejects.toThrow('binding generated identities')
    await unsafe.rollback(); unsafe.close()
  })

  it('rejects authenticated records with invalid sequence instead of applying partial data', async () => {
    await publish()
    const headObject = store.objects.get('head')!
    const head = unseal(headObject.bytes, key) as { tip: { key: string, digest: string } }
    const object = store.objects.get(head.tip.key)!
    const record = unseal(object.bytes, key) as { sequence: number }
    record.sequence = 4
    const bytes = seal(record, key)
    store.objects.set(head.tip.key, { bytes, etag: digest(bytes) })
    head.tip.digest = digest(bytes)
    const headBytes = seal(head, key)
    store.objects.set('head', { bytes: headBytes, etag: digest(headBytes) })
    await expect(recovered()).rejects.toThrow('identity or sequence differs')
  })
})
