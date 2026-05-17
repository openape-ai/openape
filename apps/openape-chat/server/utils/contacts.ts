// Helpers shared by the /api/contacts/* endpoints.
//
// Contact rows store the pair canonicalised (email_a < email_b) so a
// single row covers both directions. These helpers translate between
// "caller perspective" (peer_email + my_status + their_status) and the
// stored canonical shape.

import { randomUUID } from 'node:crypto'
import { and, eq, or } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { contacts, memberships, rooms } from '../database/schema'
import type { Contact } from '../database/schema'
import { ensureMainThread } from './threads'

export interface ContactView {
  /** Other party's email. */
  peerEmail: string
  /** Caller's own status toward the peer. */
  myStatus: 'accepted' | 'pending' | 'blocked'
  /** Peer's status toward the caller. */
  theirStatus: 'accepted' | 'pending' | 'blocked'
  /** True iff bilateral accept — chat is live. */
  connected: boolean
  /** DM room id (only when connected). */
  roomId: string | null
  requestedAt: number
  acceptedAt: number | null
}

export function canonicalize(a: string, b: string): { emailA: string, emailB: string, callerIsA: boolean } {
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()
  if (aLower < bLower) return { emailA: aLower, emailB: bLower, callerIsA: true }
  return { emailA: bLower, emailB: aLower, callerIsA: false }
}

export function projectForCaller(row: Contact, callerEmail: string): ContactView {
  const isA = row.emailA === callerEmail.toLowerCase()
  return {
    peerEmail: isA ? row.emailB : row.emailA,
    myStatus: isA ? row.statusA : row.statusB,
    theirStatus: isA ? row.statusB : row.statusA,
    connected: row.statusA === 'accepted' && row.statusB === 'accepted',
    roomId: row.roomId,
    requestedAt: row.requestedAt,
    acceptedAt: row.acceptedAt,
  }
}

export async function findContact(callerEmail: string, peerEmail: string): Promise<Contact | null> {
  const { emailA, emailB } = canonicalize(callerEmail, peerEmail)
  const db = useDb()
  const row = await db.select().from(contacts).where(and(eq(contacts.emailA, emailA), eq(contacts.emailB, emailB))).get()
  return row ?? null
}

export async function listContactsFor(callerEmail: string): Promise<ContactView[]> {
  const lower = callerEmail.toLowerCase()
  const db = useDb()
  const rows = await db.select().from(contacts).where(or(eq(contacts.emailA, lower), eq(contacts.emailB, lower))).all()
  return rows.map(r => projectForCaller(r, lower))
}

/**
 * Lazy-create the DM room when both sides are accepted. Idempotent —
 * if a row already has a room_id it's left alone.
 */
export async function ensureDmRoomFor(row: Contact): Promise<string> {
  if (row.roomId) return row.roomId
  const db = useDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  // Name: peer's email — the chat-app UI prefers showing the other party
  // anyway, and this stays useful for any legacy rooms-list views.
  await db.insert(rooms).values({
    id,
    name: `${row.emailA} ↔ ${row.emailB}`,
    kind: 'dm',
    createdByEmail: row.emailA,
    createdAt: now,
  })
  for (const email of [row.emailA, row.emailB]) {
    await db.insert(memberships).values({
      roomId: id,
      userEmail: email,
      role: 'admin',
      joinedAt: now,
    }).onConflictDoNothing()
  }
  await db.update(contacts).set({ roomId: id }).where(eq(contacts.id, row.id))
  // Auto-create the room's "main" thread so any first message has
  // somewhere to land — Phase B threads model.
  await ensureMainThread({ roomId: id, createdByEmail: row.emailA })
  return id
}

/**
 * Insert or update a contact request from `caller` to `peer`. Caller's
 * own status starts at 'accepted' (initiating == accepting); peer's at
 * 'pending'. If the reverse direction already exists pending, this acts
 * as the counter-request: both sides flip to 'accepted'.
 */
export async function upsertRequest(callerEmail: string, peerEmail: string): Promise<{ row: Contact, becameMutual: boolean }> {
  const { emailA, emailB, callerIsA } = canonicalize(callerEmail, peerEmail)
  const db = useDb()
  const now = Math.floor(Date.now() / 1000)
  const existing = await db.select().from(contacts).where(and(eq(contacts.emailA, emailA), eq(contacts.emailB, emailB))).get()

  if (!existing) {
    const id = randomUUID()
    await db.insert(contacts).values({
      id,
      emailA,
      emailB,
      statusA: callerIsA ? 'accepted' : 'pending',
      statusB: callerIsA ? 'pending' : 'accepted',
      requestedAt: now,
    })
    const fresh = await db.select().from(contacts).where(eq(contacts.id, id)).get()
    return { row: fresh!, becameMutual: false }
  }

  const callerStatus = callerIsA ? existing.statusA : existing.statusB
  const peerStatus = callerIsA ? existing.statusB : existing.statusA

  if (peerStatus === 'pending' && callerStatus !== 'accepted') {
    // Peer had requested first, caller is now accepting via counter-request.
    await db.update(contacts).set({
      statusA: 'accepted',
      statusB: 'accepted',
      acceptedAt: now,
    }).where(eq(contacts.id, existing.id))
    const refreshed = await db.select().from(contacts).where(eq(contacts.id, existing.id)).get()
    return { row: refreshed!, becameMutual: true }
  }

  // Already-accepted-by-caller (re-sending request when peer hasn't
  // accepted yet) or both-accepted (no-op): just return the row as-is.
  return { row: existing, becameMutual: false }
}

/**
 * Mark caller's side as accepted on an existing pair. If the peer is
 * already accepted, the contact is now mutual and a DM room is created.
 */
export async function acceptRequest(callerEmail: string, peerEmail: string): Promise<{ row: Contact, becameMutual: boolean } | null> {
  const { emailA, emailB, callerIsA } = canonicalize(callerEmail, peerEmail)
  const db = useDb()
  const existing = await db.select().from(contacts).where(and(eq(contacts.emailA, emailA), eq(contacts.emailB, emailB))).get()
  if (!existing) return null

  const callerStatus = callerIsA ? existing.statusA : existing.statusB
  if (callerStatus === 'accepted') {
    // No-op — already accepted on caller's side.
    return { row: existing, becameMutual: existing.statusA === 'accepted' && existing.statusB === 'accepted' }
  }

  const peerStatus = callerIsA ? existing.statusB : existing.statusA
  if (peerStatus !== 'accepted') {
    // Peer hasn't sent a request yet — there's nothing to accept.
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const updates: Partial<Contact> = callerIsA
    ? { statusA: 'accepted', acceptedAt: now }
    : { statusB: 'accepted', acceptedAt: now }
  await db.update(contacts).set(updates).where(eq(contacts.id, existing.id))
  const refreshed = await db.select().from(contacts).where(eq(contacts.id, existing.id)).get()
  return { row: refreshed!, becameMutual: true }
}

export async function deleteContact(callerEmail: string, peerEmail: string): Promise<boolean> {
  const { emailA, emailB } = canonicalize(callerEmail, peerEmail)
  const db = useDb()
  const result = await db.delete(contacts)
    .where(and(eq(contacts.emailA, emailA), eq(contacts.emailB, emailB)))
    .run()
  return (result.rowsAffected ?? 0) > 0
}
