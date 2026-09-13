// @vitest-environment node
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase, digest } from '../../src/worker/storage/database'
import { ingestMailPage } from '../../src/worker/mail/ingestion'

let root = ''; let store: PodDatabase | undefined
afterEach(async () => { store?.close(); if (root) await rm(root, { recursive: true, force: true }) })
it('retains exact source versions across pagination retries and moved old messages', async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-mail-ingest-'))); store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Mail fixture', assignment: 'Read only synthetic mail' })
  const scope = { account: 'pod@example.invalid', folders: ['rules'], attachments: true }
  async function ingest(version: string, folder = 'rules') {
    const body = JSON.stringify({ version: 1, operation: 'messages', account: scope.account, folder: 'rules', items: [{ id: 'immutable', changeKey: version, parentFolderId: folder, receivedDateTime: '2020-01-01T00:00:00Z', subject: 'Synthetic', body: { contentType: 'text', content: 'Retained evidence' } }], complete: true })
    const path = join(root, `mail-${randomUUID()}.json`); await writeFile(path, body)
    return ingestMailPage(store!, pod.id, root, { path, hash: digest(body) }, scope, { operation: 'messages', folder: 'rules' }, () => {})
  }
  const first = await ingest('v1'); const retry = await ingest('v1'); const changed = await ingest('v2')
  expect(first.items[0].sourceId).toBe(retry.items[0].sourceId)
  expect(changed.items[0].sourceId).not.toBe(first.items[0].sourceId)
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM sources').get()!.count).toBe(2)
  expect(store.checkpoint(pod.id).revision).toBe(0)
  expect(store.readBlob(first.items[0].sourceHash).toString()).toContain('Retained evidence')
  await expect(ingest('v3', 'unassigned')).rejects.toThrow('outside')
})
