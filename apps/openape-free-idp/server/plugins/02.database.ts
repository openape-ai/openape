import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, type TEXT,
      requester TEXT NOT NULL, target_host TEXT NOT NULL, audience TEXT NOT NULL,
      grant_type TEXT NOT NULL, request TEXT NOT NULL, created_at INTEGER NOT NULL,
      decided_at INTEGER, decided_by TEXT, expires_at INTEGER, used_at INTEGER
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_status ON grants(status)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_requester ON grants(requester)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_created_at ON grants(created_at)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_type ON grants(type)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS grant_challenges (
      challenge TEXT PRIMARY KEY, agent_id TEXT NOT NULL, expires_at INTEGER NOT NULL
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS credentials (
      credential_id TEXT PRIMARY KEY, user_email TEXT NOT NULL, public_key TEXT NOT NULL,
      counter INTEGER NOT NULL, transports TEXT, device_type TEXT NOT NULL,
      backed_up INTEGER NOT NULL, created_at INTEGER NOT NULL, name TEXT
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_credentials_user_email ON credentials(user_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS webauthn_challenges (
      token TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_email TEXT,
      type TEXT NOT NULL, expires_at INTEGER NOT NULL
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS registration_urls (
      token TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS ssh_keys (
      key_id TEXT PRIMARY KEY, user_email TEXT NOT NULL, public_key TEXT NOT NULL,
      name TEXT NOT NULL, created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ssh_keys_user_email ON ssh_keys(user_email)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ssh_keys_public_key ON ssh_keys(public_key)`)

    // Schema evolved past migration 0000: extra user columns + shapes table
    // are declared in schema.ts but were never added here. Without these the
    // very first login/register on a fresh DB fails with "no such table".
    await db.run(sql`CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY NOT NULL, id TEXT, name TEXT NOT NULL,
      owner TEXT, approver TEXT, type TEXT, public_key TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_users_id ON users(id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_users_owner ON users(owner)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_users_approver ON users(approver)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS shapes (
      cli_id TEXT PRIMARY KEY, executable TEXT NOT NULL, description TEXT NOT NULL,
      operations TEXT NOT NULL, source TEXT NOT NULL, digest TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_shapes_source ON shapes(source)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_shapes_executable ON shapes(executable)`)

    // OAuth/OIDC auth-code + refresh-token + JWT id + signing-key tables.
    // Declared in schema.ts but missing from this init plugin — every first
    // /authorize round-trip or token refresh on a fresh DB failed with
    // "no such table: codes | refresh_tokens | jtis | signing_keys".
    await db.run(sql`CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL, user_id TEXT NOT NULL, nonce TEXT,
      expires_at INTEGER NOT NULL, extra_data TEXT
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS jtis (
      jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS refresh_token_families (
      family_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL,
      current_token_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_families_user_id ON refresh_token_families(user_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_families_client_id ON refresh_token_families(client_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT NOT NULL,
      client_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS signing_keys (
      kid TEXT PRIMARY KEY, private_key_jwk TEXT NOT NULL, public_key_jwk TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
    )`)

    try { await db.run(sql`ALTER TABLE credentials ADD COLUMN rp_id TEXT`) }
    catch { /* already present */ }
    try { await db.run(sql`ALTER TABLE webauthn_challenges ADD COLUMN rp_id TEXT`) }
    catch { /* already present */ }
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_credentials_rp_id ON credentials(rp_id)`)

    // Pre-rp_id rows are backfilled to the canonical primary RP, otherwise
    // the upcoming tenant filter would orphan existing users.
    let defaultRp = process.env.OPENAPE_DEFAULT_RP_ID?.trim() || ''
    if (!defaultRp && process.env.OPENAPE_ISSUER) {
      try { defaultRp = new URL(process.env.OPENAPE_ISSUER).hostname }
      catch { /* invalid URL, fall through */ }
    }
    if (!defaultRp) defaultRp = 'id.openape.ai'
    await db.run(sql`UPDATE credentials SET rp_id = ${defaultRp} WHERE rp_id IS NULL`)

    // YOLO auto-approval policies (one per agent; presence = enabled).
    await db.run(sql`CREATE TABLE IF NOT EXISTS yolo_policies (
      agent_email TEXT PRIMARY KEY,
      enabled_by TEXT NOT NULL,
      deny_risk_threshold TEXT,
      deny_patterns TEXT NOT NULL DEFAULT '[]',
      enabled_at INTEGER NOT NULL,
      expires_at INTEGER,
      updated_at INTEGER NOT NULL
    )`)

    // auto_approval_kind column on grants — null = human, 'standing' or 'yolo'.
    try { await db.run(sql`ALTER TABLE grants ADD COLUMN auto_approval_kind TEXT`) }
    catch { /* already present */ }
    // decided_by_standing_grant — id of the standing grant that auto-approved
    // this grant, for audit. Nullable. Drizzle's `db.select().from(grants)`
    // includes this column on every read, so a missing column means every
    // /api/grants and /api/standing-grants call 500s on existing prod DBs.
    try { await db.run(sql`ALTER TABLE grants ADD COLUMN decided_by_standing_grant TEXT`) }
    catch { /* already present */ }

    // Web Push subscriptions for grant-approval notifications. Endpoint is
    // the browser-push-service URL (stable per browser install) and serves
    // as the natural primary key; the helper upserts on it so re-subscribing
    // the same browser doesn't create duplicate rows.
    await db.run(sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_push_subs_user_email ON push_subscriptions(user_email)`)

    // DDISA allowlist-user consents (#301). One row per (user, SP)
    // pair the user has approved on the consent screen. PK is
    // composite — re-approval is an upsert on grantedAt; revocation
    // is a DELETE.
    await db.run(sql`CREATE TABLE IF NOT EXISTS consents (
      user_email TEXT NOT NULL,
      client_id TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      PRIMARY KEY (user_email, client_id)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_consents_user_email ON consents(user_email)`)

    // DNS-rooted admin claim (#307). Each user can mint a random
    // secret which they publish at _openape-admin-{idp}.{their-domain}
    // to claim root admin status for that domain. We store only
    // sha256(secret); the cleartext is shown to the user once.
    await db.run(sql`CREATE TABLE IF NOT EXISTS admin_claim_secrets (
      user_email TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      PRIMARY KEY (user_email, secret_hash)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_admin_claim_user ON admin_claim_secrets(user_email)`)

    // Operators — DB-stored admins for a specific domain, promoted
    // by a DNS-rooted root admin via the admin UI.
    await db.run(sql`CREATE TABLE IF NOT EXISTS operators (
      user_email TEXT NOT NULL,
      domain TEXT NOT NULL,
      promoted_by TEXT NOT NULL,
      promoted_at INTEGER NOT NULL,
      PRIMARY KEY (user_email, domain)
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_operators_domain ON operators(domain)`)

    // mode=allowlist-admin SP allowlist, scoped per domain.
    await db.run(sql`CREATE TABLE IF NOT EXISTS admin_allowlist (
      domain TEXT NOT NULL,
      client_id TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      approved_at INTEGER NOT NULL,
      PRIMARY KEY (domain, client_id)
    )`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
