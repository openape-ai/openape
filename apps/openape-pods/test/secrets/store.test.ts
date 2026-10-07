// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase, schemaVersion } from '../../src/worker/storage/database'
import { SecretRequests } from '../../src/worker/secrets/store'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() { const root = mkdtempSync(join(tmpdir(), 'pods-secret-rows-')); roots.push(root); const store = new PodDatabase(root); stores.push(store); return store }
const row = (podId: string) => ({ id: '01REQ0', podId, alias: 'telegram_bot_token', purpose: 'reports', status: 'requested' as const, expiresAt: 2000, createdAt: 1000, updatedAt: 1000, error: null })

it('records request rows per Pod at schema 39, updates their state and never holds a value', () => {
  const store = fixture(); const pod = store.createPod({ name: 'Reporter' })
  expect(schemaVersion).toBe(41)
  const rows = new SecretRequests(store)
  expect(rows.execute({ type: 'record', row: row(pod.id) })).toEqual([row(pod.id)])
  expect(rows.execute({ type: 'update', id: '01REQ0', patch: { status: 'collected', updatedAt: 1500 } })[0]).toMatchObject({ status: 'collected', updatedAt: 1500 })
  expect(() => rows.execute({ type: 'update', id: 'missing', patch: { status: 'expired' } })).toThrow('Secret request not found')
  expect(() => rows.execute({ type: 'record', row: { ...row(pod.id), id: '01REQ1', status: 'sealed' as never } })).toThrow('Invalid secret request')
  expect(() => rows.execute({ type: 'record', row: row('00000000-0000-4000-8000-00000000dead') })).toThrow()
  expect(store.db.prepare('SELECT * FROM secret_requests').all().map(item => Object.keys(item))).toEqual([['id', 'pod_id', 'alias', 'purpose', 'status', 'expires_at', 'created_at', 'updated_at', 'error']])
  expect(rows.list(pod.id)).toHaveLength(1); expect(rows.list('00000000-0000-4000-8000-00000000dead')).toEqual([])
})
