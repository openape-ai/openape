import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** How long a request may wait to be filled before it lapses. */
export const DEFAULT_TTL_SEC = 24 * 60 * 60
export const MAX_TTL_SEC = 7 * 24 * 60 * 60

/**
 * A machine that may RECEIVE secrets. Registered by its owner, who is also the
 * only person a request for it can ask. The public key is the whole point: the
 * value is sealed against it in the browser, so this service stores ciphertext
 * it has no way to open.
 */
export const consumers = sqliteTable('consumers', {
  id: text('id').primaryKey(),
  ownerEmail: text('owner_email').notNull(),
  name: text('name').notNull(),
  /** P-256 public key as JWK. Public half only — the private half never leaves the machine. */
  publicKeyJwk: text('public_key_jwk').notNull(),
  /**
   * Identities besides the owner that may raise a request for this consumer,
   * as a JSON string[]. Empty means owner-only, which is the safe default: an
   * open service would let anyone send fill prompts to a stranger.
   */
  allowedRequesters: text('allowed_requesters').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
}, t => [index('idx_consumers_owner').on(t.ownerEmail)])

/**
 * `requested` → someone asked · `filled` → the owner sealed a value into it
 * · `fetched` → the consumer collected it and the ciphertext is gone
 * · `expired` / `cancelled` → nothing will arrive.
 */
export type SecretRequestStatus = 'requested' | 'filled' | 'fetched' | 'expired' | 'cancelled'

export const secretRequests = sqliteTable('secret_requests', {
  id: text('id').primaryKey(),
  /** The human who has to fill this — always the consumer's owner. */
  ownerEmail: text('owner_email').notNull(),
  /** Who asked. Shown on the fill page: the owner decides knowing who benefits. */
  requester: text('requester').notNull(),
  consumerId: text('consumer_id').notNull(),
  /** What is being asked for, e.g. NUXT_TELEGRAM_BOT_TOKEN. */
  fieldName: text('field_name').notNull(),
  /** Why. Free text from the requester, rendered verbatim to the owner. */
  purpose: text('purpose').notNull().default(''),
  status: text('status', { enum: ['requested', 'filled', 'fetched', 'expired', 'cancelled'] }).notNull().default('requested'),
  expiresAt: integer('expires_at').notNull(),
  /**
   * The sealed envelope, all base64: ephemeral public key, HKDF salt, AES-GCM
   * IV, ciphertext. Null until filled, and null again once fetched — a
   * collected secret leaves nothing behind to steal.
   */
  boxEpk: text('box_epk'),
  boxSalt: text('box_salt'),
  boxIv: text('box_iv'),
  boxCt: text('box_ct'),
  createdAt: integer('created_at').notNull(),
  filledAt: integer('filled_at'),
  fetchedAt: integer('fetched_at'),
}, t => [
  index('idx_requests_owner').on(t.ownerEmail),
  index('idx_requests_consumer').on(t.consumerId),
])
