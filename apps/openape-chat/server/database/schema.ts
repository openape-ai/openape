import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // 'channel' = many-member room, 'dm' = exactly two members
  kind: text('kind', { enum: ['channel', 'dm'] }).notNull(),
  createdByEmail: text('created_by_email').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const memberships = sqliteTable('memberships', {
  roomId: text('room_id').notNull(),
  userEmail: text('user_email').notNull(),
  role: text('role', { enum: ['member', 'admin'] }).notNull().default('member'),
  joinedAt: integer('joined_at').notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.roomId, t.userEmail] }),
}))

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull(),
  // Phase B: each room has one or more threads; messages live on a
  // thread. Nullable for back-compat with rows written before Phase B —
  // those get treated as the room's "main" thread by query-side joins.
  threadId: text('thread_id'),
  senderEmail: text('sender_email').notNull(),
  // 'human' or 'agent' — purely a display hint, not a permission boundary in v1
  senderAct: text('sender_act', { enum: ['human', 'agent'] }).notNull(),
  body: text('body').notNull(),
  replyTo: text('reply_to'),
  createdAt: integer('created_at').notNull(),
  editedAt: integer('edited_at'),
})

// Phase B: parallel sessions inside a single 1:1 contact (= room).
// Each thread has its own bridge pi-RPC session — context is isolated.
// Default "main" thread is auto-created on contact-accept (or lazy-
// created on first GET for legacy rooms).
export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull(),
  name: text('name').notNull(),
  createdByEmail: text('created_by_email').notNull(),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
})

export const reactions = sqliteTable('reactions', {
  messageId: text('message_id').notNull(),
  userEmail: text('user_email').notNull(),
  emoji: text('emoji').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.messageId, t.userEmail, t.emoji] }),
}))

// Contacts — the user-facing 1:1 relationship. Each row is one pair,
// canonicalised to email_a < email_b so a single row covers both
// directions. Both sides have an independent status because one party
// can accept while the other still pending.
//
// On bilateral accept, room_id points at the auto-created DM room; until
// then it stays NULL and the chat shell shows "pending" instead of a
// composer.
export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  emailA: text('email_a').notNull(),
  emailB: text('email_b').notNull(),
  // 'accepted' | 'pending' | 'blocked'. The initiator implicitly accepts
  // (their own status starts as 'accepted'); the recipient starts pending.
  statusA: text('status_a', { enum: ['accepted', 'pending', 'blocked'] }).notNull(),
  statusB: text('status_b', { enum: ['accepted', 'pending', 'blocked'] }).notNull(),
  roomId: text('room_id'),
  requestedAt: integer('requested_at').notNull(),
  acceptedAt: integer('accepted_at'),
})

// Web-Push subscriptions. One row per (user, endpoint). Endpoint is the
// browser's push service URL — it's stable per (user, browser, install)
// and is used as the natural primary key for upserts. p256dh + auth are
// the public encryption keys the server must use to encrypt push payloads.
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  userEmail: text('user_email').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at').notNull(),
})

export type Room = typeof rooms.$inferSelect
export type NewRoom = typeof rooms.$inferInsert
export type Membership = typeof memberships.$inferSelect
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type Reaction = typeof reactions.$inferSelect
export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
export type Thread = typeof threads.$inferSelect
export type NewThread = typeof threads.$inferInsert
export type PushSubscription = typeof pushSubscriptions.$inferSelect
