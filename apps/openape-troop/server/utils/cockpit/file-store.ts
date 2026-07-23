import { randomUUID } from 'node:crypto'
import { and, eq, lt, notInArray, sql } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitChatMessages, cockpitFiles } from '../../database/schema'

// Chat attachments (#980). Bytes live as LibSQL blobs; every read/write is
// owner-bound. The mime allowlist is deliberate and small — no SVG (script
// carrier). The declared content-type is a client claim, so the magic bytes
// decide, not the header.

export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_FILES_PER_MESSAGE = 4

export interface FileRef { id: string, mime: string, name: string }

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/png': b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
  'image/jpeg': b => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/webp': b => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': b => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
}

export const ALLOWED_MIMES = Object.keys(MAGIC)

/** Validate + store. Returns the ref or a human-readable error string. */
export async function saveFile(owner: string, orgId: string, name: string, mime: string, bytes: Buffer): Promise<FileRef | { error: string, status: number }> {
  if (bytes.length > MAX_FILE_BYTES) return { error: `file exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB`, status: 413 }
  if (bytes.length === 0) return { error: 'empty file', status: 400 }
  const check = MAGIC[mime]
  if (!check) return { error: `mime not allowed (${ALLOWED_MIMES.join(', ')})`, status: 400 }
  if (!check(bytes)) return { error: 'file content does not match its declared type', status: 400 }
  const ref: FileRef = { id: randomUUID(), mime, name: sanitizeName(name) }
  await useDb().insert(cockpitFiles).values({ ...ref, ownerEmail: owner, orgId, size: bytes.length, bytes, createdAt: Date.now() })
  return ref
}

export async function loadFile(owner: string, id: string) {
  const [row] = await useDb().select().from(cockpitFiles).where(and(eq(cockpitFiles.id, id), eq(cockpitFiles.ownerEmail, owner)))
  return row
}

/** The refs the caller may attach: each id must exist AND belong to this owner. */
export async function resolveRefs(owner: string, ids: string[]): Promise<FileRef[] | null> {
  if (ids.length > MAX_FILES_PER_MESSAGE) return null
  const refs: FileRef[] = []
  for (const id of ids) {
    const row = await loadFile(owner, id)
    if (!row) return null
    refs.push({ id: row.id, mime: row.mime, name: row.name })
  }
  return refs
}

// A filename renders in bubbles and lands in content-disposition — strip
// anything that could break either.
function sanitizeName(name: string): string {
  const clean = name.replace(/[\r\n"\\/]/g, '_').trim().slice(0, 120)
  return clean || 'datei'
}

// Boot sweep: drop file rows older than maxAgeMs that no chat message
// references (upload happened, send never did — or the chat was cleared).
export async function sweepOrphanFiles(maxAgeMs: number, now: number): Promise<number> {
  const db = useDb()
  const referenced = new Set<string>()
  const rows = await db.select({ files: cockpitChatMessages.files }).from(cockpitChatMessages).where(sql`${cockpitChatMessages.files} IS NOT NULL`)
  for (const r of rows) for (const f of r.files ?? []) referenced.add(f.id)
  const cutoff = now - maxAgeMs
  const stale = referenced.size
    ? and(lt(cockpitFiles.createdAt, cutoff), notInArray(cockpitFiles.id, [...referenced]))
    : lt(cockpitFiles.createdAt, cutoff)
  const res = await db.delete(cockpitFiles).where(stale)
  return Number((res as { rowsAffected?: number }).rowsAffected ?? 0)
}
