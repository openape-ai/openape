import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestAuthenticator } from '../../../packages/auth/src/__tests__/webauthn-test-authenticator'
import { openSecret, sealSecret } from '../shared/vault-crypto'
import type { Caller, SetupOptions } from './support/vault'
import { call, caller, ORIGIN, RP_ID, status, VAULT_TABLE_NAMES, vaultSetupBody } from './support/vault'

// Saving, versioning and deleting vault secrets. Every change needs a fresh
// assertion from one of the vault's passkeys: a stolen session must not be able
// to swap a value the owner later hands to a machine.

vi.mock('../server/database/drizzle', async () => {
  const { createClient } = await import('@libsql/client')
  const { drizzle } = await import('drizzle-orm/libsql')
  const schema = await import('../server/database/schema')
  const { applyVaultSchema } = await import('../server/database/vault-tables')
  const client = createClient({ url: 'file::memory:?cache=shared' })
  await applyVaultSchema(statement => client.execute(statement))
  return { useDb: () => drizzle(client, { schema }) }
})
vi.mock('h3', async () => (await import('./support/vault')).h3Mock())
vi.stubGlobal('useRuntimeConfig', () => ({ vaultEnabled: true, vaultRpId: RP_ID, vaultOrigin: ORIGIN }))
vi.stubGlobal('getSpSession', async (e: { __session?: unknown }) => ({ data: e.__session ?? {} }))

const setupOptions = (await import('../server/api/v2/vault/setup/options.post')).default
const setupCommit = (await import('../server/api/v2/vault/setup/commit.post')).default
const actionOptions = (await import('../server/api/v2/vault/actions/options.post')).default
const actionCommit = (await import('../server/api/v2/vault/actions/commit.post')).default
const credentialOptions = (await import('../server/api/v2/vault/credentials/options.post')).default
const listSecrets = (await import('../server/api/v2/secrets/index.get')).default
const readSecret = (await import('../server/api/v2/secrets/[id].get')).default
const { useDb } = await import('../server/database/drizzle')

type Vault = Awaited<ReturnType<typeof vaultSetupBody>> & { id: string, me: Caller }

let signCount = 0
interface ActionOptions { challengeId: string, vaultId: string, secretId: string, version: number, assertion: { challenge: string } }
interface SecretView { id: string, alias: string, type: string, version: number, versions: Array<{ version: number }>, sealed: Parameters<typeof openSecret>[1] }

async function newVault(): Promise<Vault> {
  const me = caller()
  const opts = await call<SetupOptions>(setupOptions, me)
  const setup = await vaultSetupBody(opts)
  await call(setupCommit, me, setup.body)
  return { ...setup, id: opts.vaultId, me }
}

/** Ask for an action and confirm it with a passkey (the vault's own unless `signer` says otherwise); `commit` sends it. */
async function prepare(vault: Vault, request: Record<string, unknown>, fields: (o: ActionOptions) => Promise<Record<string, unknown>> | Record<string, unknown> = () => ({}), signer?: ReturnType<typeof createTestAuthenticator>) {
  const opts = await call<ActionOptions>(actionOptions, vault.me, request)
  // Real authenticators count up with every use; WebAuthn refuses a counter that does not.
  const assertion = vault.passkey.createAuthenticationResponse({ challenge: opts.assertion.challenge, origin: ORIGIN, rpId: RP_ID, signingKey: signer?.privateKey, counter: ++signCount })
  const body = { challengeId: opts.challengeId, assertion, ...await fields(opts) }
  return { opts, commit: () => call<{ secret_id: string, version: number }>(actionCommit, vault.me, body) }
}

function saveFields(vault: Vault, value: string, extra: Record<string, unknown> = {}) {
  return async (o: ActionOptions) =>
    ({ sealed: await sealSecret(vault.vmk, value, { vaultId: o.vaultId, secretId: o.secretId, version: o.version }), ...extra })
}

async function saveNew(vault: Vault, alias: string, value: string) {
  return (await prepare(vault, { action: 'secret.save' }, saveFields(vault, value, { alias, type: 'token' }))).commit()
}

beforeEach(async () => {
  for (const table of VAULT_TABLE_NAMES) await useDb().run(`DELETE FROM ${table}` as never)
})

describe('saving a secret', () => {
  it('stores ciphertext the owner can open, and lists only metadata', async () => {
    const vault = await newVault()
    const { secret_id } = await saveNew(vault, 'TELEGRAM_BOT_TOKEN', 'tg-123:secret')

    const list = await call<Array<{ alias: string, version: number }>>(listSecrets, vault.me, undefined, 'GET')
    expect(list).toMatchObject([{ alias: 'TELEGRAM_BOT_TOKEN', version: 1 }])
    expect(JSON.stringify(list)).not.toContain('sealed')

    const detail = await call<SecretView>(readSecret, vault.me, undefined, 'GET', { id: secret_id })
    expect(await openSecret(vault.vmk, detail.sealed, { vaultId: vault.id, secretId: secret_id, version: 1 })).toBe('tg-123:secret')
    const rows = JSON.stringify(await useDb().run('SELECT * FROM vault_secret_versions' as never))
    expect(rows).not.toContain('tg-123:secret')
  })

  it('is refused without an assertion from one of the vault\'s passkeys', async () => {
    const vault = await newVault()
    const forged = await prepare(vault, { action: 'secret.save' }, saveFields(vault, 'x', { alias: 'A', type: 'token' }), createTestAuthenticator())
    expect(await status(forged.commit())).toBe(400)
    expect(await call<unknown[]>(listSecrets, vault.me, undefined, 'GET')).toHaveLength(0)
  })

  it('refuses a challenge issued for another operation', async () => {
    const vault = await newVault()
    const other = await call<{ challengeId: string, assertion: { challenge: string } }>(credentialOptions, vault.me)
    const assertion = vault.passkey.createAuthenticationResponse({ challenge: other.assertion.challenge, origin: ORIGIN, rpId: RP_ID })
    expect(await status(call(actionCommit, vault.me, { challengeId: other.challengeId, assertion, alias: 'A', type: 'token' }))).toBe(400)
  })

  it('refuses a name that is already in the vault', async () => {
    const vault = await newVault()
    await saveNew(vault, 'GITHUB_TOKEN', 'a')
    expect(await status(saveNew(vault, 'GITHUB_TOKEN', 'b'))).toBe(409)
  })

  it('refuses an unusable name', async () => {
    const vault = await newVault()
    expect(await status(saveNew(vault, 'has spaces', 'a'))).toBe(400)
  })
})

describe('new versions', () => {
  it('keep the history and make the newest current', async () => {
    const vault = await newVault()
    const { secret_id } = await saveNew(vault, 'GITHUB_TOKEN', 'old')
    const next = await prepare(vault, { action: 'secret.save', secretId: secret_id }, saveFields(vault, 'new'))
    expect(await next.commit()).toMatchObject({ version: 2 })

    const detail = await call<SecretView>(readSecret, vault.me, undefined, 'GET', { id: secret_id })
    expect(detail.version).toBe(2)
    expect(detail.versions.map(v => v.version)).toEqual([2, 1])
    expect(await openSecret(vault.vmk, detail.sealed, { vaultId: vault.id, secretId: secret_id, version: 2 })).toBe('new')
  })

  it('refuse a second change prepared from the same old version', async () => {
    const vault = await newVault()
    const { secret_id } = await saveNew(vault, 'GITHUB_TOKEN', 'v1')
    const tabA = await prepare(vault, { action: 'secret.save', secretId: secret_id }, saveFields(vault, 'from tab A'))
    const tabB = await prepare(vault, { action: 'secret.save', secretId: secret_id }, saveFields(vault, 'from tab B'))
    await tabA.commit()
    expect(await status(tabB.commit())).toBe(409)
  })
})

describe('deleting a secret', () => {
  it('removes it from the vault after a passkey confirmation', async () => {
    const vault = await newVault()
    const { secret_id } = await saveNew(vault, 'OLD_KEY', 'x')
    await (await prepare(vault, { action: 'secret.delete', secretId: secret_id })).commit()
    expect(await call<unknown[]>(listSecrets, vault.me, undefined, 'GET')).toHaveLength(0)
    expect(await status(call(readSecret, vault.me, undefined, 'GET', { id: secret_id }))).toBe(404)
  })

  it('removes every stored version, not only the name', async () => {
    const vault = await newVault()
    const { secret_id } = await saveNew(vault, 'OLD_KEY', 'x')
    await (await prepare(vault, { action: 'secret.delete', secretId: secret_id })).commit()
    const left = (await useDb().run(`SELECT count(*) AS n FROM vault_secret_versions WHERE secret_id = '${secret_id}'` as never)) as unknown as { rows: Array<{ n: number }> }
    expect(Number(left.rows[0]!.n)).toBe(0)
  })
})

describe('isolation', () => {
  it('hides one owner\'s secret from another owner', async () => {
    const vault = await newVault()
    const { secret_id } = await saveNew(vault, 'PRIVATE', 'x')
    const stranger = (await newVault()).me
    expect(await status(call(readSecret, stranger, undefined, 'GET', { id: secret_id }))).toBe(404)
    expect(await status(prepare({ ...vault, me: stranger }, { action: 'secret.delete', secretId: secret_id }))).toBe(404)
  })
})
