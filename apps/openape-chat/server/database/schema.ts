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
  senderEmail: text('sender_email').notNull(),
  // 'human' or 'agent' — purely a display hint, not a permission boundary in v1
  senderAct: text('sender_act', { enum: ['human', 'agent'] }).notNull(),
  body: text('body').notNull(),
  replyTo: text('reply_to'),
  createdAt: integer('created_at').notNull(),
  editedAt: integer('edited_at'),
})

export const reactions = sqliteTable('reactions', {
  messageId: text('message_id').notNull(),
  userEmail: text('user_email').notNull(),
  emoji: text('emoji').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.messageId, t.userEmail, t.emoji] }),
}))

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
export type PushSubscription = typeof pushSubscriptions.$inferSelect
