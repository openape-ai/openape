import { constants } from 'node:fs'
import { open, realpath, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { MailArtifact } from '../../main/mail/service'
import type { MailRead, MailScope } from '../../main/mail/contract'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mail provider object')
  return value as Record<string, unknown>
}
function text(value: unknown, maximum = 2048): string {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0')) throw new Error('Invalid mail provider text')
  return value
}
export interface MailItem { id: string, version: string, sourceId: string, sourceHash: string, subject: string, conversationId: string, receivedAt: string, sentAt: string, hasAttachments: boolean, contentType: string, excerpt: string, truncated: boolean }
export interface MailPage { version: 1, operation: MailRead['operation'], account: string, folder: string, items: MailItem[], nextCursor: string | null, complete: boolean }

export async function ingestMailPage(store: PodDatabase, podId: string, root: string, artifact: MailArtifact, scope: MailScope, request: MailRead, assertCurrent: () => void): Promise<MailPage> {
  if (!/^[a-f0-9]{64}$/.test(artifact.hash) || dirname(artifact.path) !== root || !/\/mail-[a-f0-9-]{36}\.json$/.test(artifact.path) || await realpath(root) !== root) throw new Error('Mail artifact is outside the run directory')
  const file = await open(artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let raw: Buffer
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Mail artifact exceeds its limit')
    raw = await file.readFile()
  }
  finally { await file.close() }
  if (digest(raw) !== artifact.hash) throw new Error('Mail artifact integrity mismatch')
  let parsed: unknown
  try { parsed = JSON.parse(raw.toString()) }
  catch { throw new Error('Mail tool returned invalid JSON') }
  const page = object(parsed)
  if (page.version !== 1 || page.operation !== request.operation || page.account !== scope.account || page.folder !== request.folder || !scope.folders.includes(request.folder) || (page.message ?? undefined) !== request.message || !Array.isArray(page.items) || page.items.length > 100 || typeof page.complete !== 'boolean' || (page.nextCursor !== undefined && (typeof page.nextCursor !== 'string' || page.nextCursor.length > 16384)) || page.complete !== !page.nextCursor) throw new Error('Mail response does not match the assigned read')
  const sources: { id: string, version: string, locator: string, hash: string }[] = []
  const items = page.items.map((value): MailItem => {
    const row = object(value); const id = text(row.id)
    if (request.operation === 'messages' && row.parentFolderId !== request.folder) throw new Error('Provider returned a message outside the selected folder')
    if (request.operation === 'attachment' && id !== request.attachment) throw new Error('Provider returned another attachment')
    const source = JSON.stringify({ provider: 'o365-cli', account: scope.account, folder: request.folder, operation: request.operation, message: request.message ?? id, data: row })
    if (Buffer.byteLength(source) > 8 * 1024 * 1024) throw new Error('Mail item exceeds the 8 MiB source limit; record an ingestion gap')
    const version = request.operation === 'messages' ? text(row.changeKey) : digest(source)
    const sourceId = `mail:${digest(`${scope.account}\0${request.message ?? id}\0${request.operation}\0${id}\0${version}`)}`
    const hash = store.putBlob(source)
    sources.push({ id: sourceId, version, locator: `o365://${encodeURIComponent(scope.account)}/${request.operation}/${encodeURIComponent(id)}`, hash })
    const body = row.body ? object(row.body) : undefined
    const content = body?.content ?? (row.contentBytes ? '[Attachment bytes retained in source; extraction required]' : '')
    if (typeof content !== 'string') throw new Error('Invalid message content')
    return { id, version, sourceId, sourceHash: hash, subject: typeof row.subject === 'string' ? row.subject.slice(0, 1024) : typeof row.name === 'string' ? row.name.slice(0, 1024) : '', conversationId: typeof row.conversationId === 'string' ? row.conversationId.slice(0, 2048) : '', receivedAt: typeof row.receivedDateTime === 'string' ? row.receivedDateTime : '', sentAt: typeof row.sentDateTime === 'string' ? row.sentDateTime : '', hasAttachments: row.hasAttachments === true, contentType: typeof body?.contentType === 'string' ? body.contentType : typeof row.contentType === 'string' ? row.contentType : '', excerpt: content.slice(0, 6000), truncated: content.length > 6000 }
  })
  assertCurrent()
  store.transaction(() => {
    store.getPod(podId)
    for (const source of sources) {
      const existing = store.db.prepare('SELECT hash,locator FROM sources WHERE pod_id=? AND id=? AND version=?').get(podId, source.id, source.version)
      if (existing && (existing.hash !== source.hash || existing.locator !== source.locator)) throw new Error('Mail source version conflict')
      store.db.prepare('INSERT OR IGNORE INTO sources VALUES(?,?,?,?,?)').run(podId, source.id, source.version, source.locator, source.hash)
    }
  })
  await rm(artifact.path)
  return { version: 1, operation: request.operation, account: scope.account, folder: request.folder, items, nextCursor: page.nextCursor as string | undefined ?? null, complete: page.complete }
}
