/**
 * Additive tables for the v2 vault. Only ciphertext, public keys and metadata:
 * no column may ever hold a PRF output, a VMK, a DEK or a recovery secret.
 * The startup plugin and the tests run the same statements.
 */
export const VAULT_TABLES = [
  `CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL DEFAULT 'v2',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vault_credentials (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL REFERENCES vaults(id),
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    backed_up INTEGER NOT NULL DEFAULT 0,
    device_type TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    prf_input TEXT NOT NULL,
    kdf_salt TEXT NOT NULL,
    vmk_iv TEXT NOT NULL,
    vmk_ct TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    disabled_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vault_credentials_vault ON vault_credentials(vault_id)`,
  `CREATE TABLE IF NOT EXISTS vault_recovery (
    vault_id TEXT PRIMARY KEY REFERENCES vaults(id),
    recovery_salt TEXT NOT NULL,
    vmk_iv TEXT NOT NULL,
    vmk_ct TEXT NOT NULL,
    proof_key_iv TEXT NOT NULL,
    proof_key_ct TEXT NOT NULL,
    proof_public_jwk TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id TEXT PRIMARY KEY,
    challenge_hash TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    operation TEXT NOT NULL,
    vault_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS secret_audit_events (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    event TEXT NOT NULL,
    vault_id TEXT,
    credential_id TEXT,
    result TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
]
