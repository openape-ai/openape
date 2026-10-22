import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestAuthenticator } from '../../../packages/auth/src/__tests__/webauthn-test-authenticator'
import { b64u, createRecovery, credentialKek, newRecoverySecret, newVmk, openRecovery, unwrapVmk, wrapVmk } from '../shared/vault-crypto'

// Vault setup, second passkey and recovery. The WebAuthn responses come from a
// software authenticator and go through the real @simplewebauthn/server
// verification; only the HTTP and session plumbing is stubbed. Most tests are
// refusals, because a vault that opens for the wrong caller is worse than none.

vi.mock('../server/database/drizzle', async () => {
  const { createClient } = await import('@libsql/client')
  const { drizzle } = await import('drizzle-orm/libsql')
  const schema = await import('../server/database/schema')
  const { VAULT_TABLES } = await import('../server/database/vault-tables')
  const client = createClient({ url: 'file::memory:?cache=shared' })
  for (const statement of VAULT_TABLES) await client.execute(statement)
  return { useDb: () => drizzle(client, { schema }) }
})

const ORIGIN = 'https://secrets.test'
const RP_ID = 'secrets.test'
let enabled = true
vi.stubGlobal('useRuntimeConfig', () => ({ vaultEnabled: enabled, vaultRpId: RP_ID, vaultOrigin: ORIGIN }))
vi.stubGlobal('getSpSession', async (e: { __session?: unknown }) => ({ data: e.__session ?? {} }))

vi.mock('h3', () => ({
  defineEventHandler: (fn: unknown) => fn,
  readBody: async (e: { __body: unknown }) => e.__body,
  getHeader: (e: { __headers?: Record<string, string> }, name: string) => e.__headers?.[name.toLowerCase()],
  getMethod: (e: { __method?: string }) => e.__method ?? 'GET',
  setResponseHeader: () => {},
  setResponseStatus: () => {},
  createError: (opts: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(opts.statusMessage ?? 'error'), { statusCode: opts.statusCode, data: opts.data }),
}))

const getVault = (await import('../server/api/v2/vault/index.get')).default
const setupOptions = (await import('../server/api/v2/vault/setup/options.post')).default
const setupCommit = (await import('../server/api/v2/vault/setup/commit.post')).default
const credentialOptions = (await import('../server/api/v2/vault/credentials/options.post')).default
const credentialCommit = (await import('../server/api/v2/vault/credentials/commit.post')).default
const recoveryOptions = (await import('../server/api/v2/vault/recovery/options.post')).default
const recoveryCommit = (await import('../server/api/v2/vault/recovery/commit.post')).default
const { useDb } = await import('../server/database/drizzle')
const { VAULT_TABLES } = await import('../server/database/vault-tables')

type Handler = (e: never) => Promise<unknown>
interface Caller { email?: string, act?: string, origin?: string, bearerOnly?: boolean }

let me: Caller = {}
function call<T>(handler: unknown, body?: unknown, method = 'POST', who: Caller = me): Promise<T> {
  const session = who.bearerOnly ? {} : { claims: { email: who.email, act: who.act } }
  const headers: Record<string, string> = { origin: who.origin ?? ORIGIN }
  return (handler as Handler)({ __body: body, __method: method, __headers: headers, __session: session, context: { params: {} } } as never) as Promise<T>
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p
    return 200
  }
  catch (err) {
    return (err as { statusCode?: number }).statusCode ?? 500
  }
}

const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))

interface Options { challengeId: string, vaultId: string, publicKey: { challenge: string } }

/** What the owner's browser does during setup, with a software passkey and a simulated PRF output. */
async function setUpVault() {
  const passkey = createTestAuthenticator()
  const prf = rnd(32)
  const prfInput = rnd(32)
  const kdfSalt = rnd(32)
  const vmk = newVmk()
  const recoverySecret = newRecoverySecret()
  const opts = await call<Options>(setupOptions)
  const kek = await credentialKek(prf, kdfSalt, opts.vaultId, passkey.credentialId)
  const body = {
    challengeId: opts.challengeId,
    credential: passkey.createRegistrationResponse({ challenge: opts.publicKey.challenge, origin: ORIGIN, rpId: RP_ID }),
    label: 'Test passkey',
    prfInput: b64u(prfInput),
    kdfSalt: b64u(kdfSalt),
    vmkWrap: await wrapVmk(kek, vmk, opts.vaultId, passkey.credentialId),
    recovery: await createRecovery(vmk, recoverySecret, opts.vaultId),
  }
  return { passkey, prf, kdfSalt, vmk, recoverySecret, opts, body }
}

beforeEach(async () => {
  enabled = true
  me = { email: `owner-${Math.random().toString(36).slice(2)}@example.com`, act: 'human' }
  // Fresh tables per test: tests share one in-memory database.
  const db = useDb()
  for (const table of ['secret_audit_events', 'webauthn_challenges', 'vault_recovery', 'vault_credentials', 'vaults']) {
    await db.run(`DELETE FROM ${table}` as never)
  }
  expect(VAULT_TABLES.length).toBeGreaterThan(0)
})

describe('who may touch the vault routes', () => {
  it('pretends the routes do not exist while the feature flag is off', async () => {
    enabled = false
    expect(await status(call(setupOptions))).toBe(404)
    expect(await status(call(getVault, undefined, 'GET'))).toBe(404)
  })

  it('refuses a caller without a browser session, even with a token', async () => {
    expect(await status(call(setupOptions, undefined, 'POST', { bearerOnly: true }))).toBe(401)
  })

  it('refuses an agent session', async () => {
    expect(await status(call(setupOptions, undefined, 'POST', { email: 'bot@example.com', act: 'agent' }))).toBe(403)
  })

  it('refuses a write from a foreign origin', async () => {
    expect(await status(call(setupOptions, undefined, 'POST', { ...me, origin: 'https://evil.test' }))).toBe(403)
  })
})

describe('vault setup', () => {
  it('stores wrappers the owner can open again, and nothing that opens them', async () => {
    const { prf, kdfSalt, vmk, opts, body } = await setUpVault()
    await call(setupCommit, body)

    const view = await call<{ id: string, credentials: Array<{ id: string, vmkWrap: { iv: string, ct: string } }> }>(getVault, undefined, 'GET')
    expect(view.id).toBe(opts.vaultId)
    const cred = view.credentials[0]!
    const kek = await credentialKek(prf, kdfSalt, view.id, cred.id)
    expect(await unwrapVmk(kek, cred.vmkWrap, view.id, cred.id)).toEqual(vmk)

    const rows = JSON.stringify(await useDb().run('SELECT * FROM vault_credentials' as never))
      + JSON.stringify(await useDb().run('SELECT * FROM vault_recovery' as never))
    expect(rows).not.toContain(b64u(prf))
    expect(rows).not.toContain(b64u(vmk))
  })

  it('refuses a response that carries PRF output', async () => {
    const { body } = await setUpVault()
    const leaked = { ...body, credential: { ...body.credential, clientExtensionResults: { prf: { results: { first: b64u(rnd(32)) } } } } }
    expect(await status(call(setupCommit, leaked))).toBe(400)
  })

  it('refuses a passkey that did not verify the user', async () => {
    const { passkey, opts, body } = await setUpVault()
    const credential = passkey.createRegistrationResponse({ challenge: opts.publicKey.challenge, origin: ORIGIN, rpId: RP_ID, userVerified: false })
    expect(await status(call(setupCommit, { ...body, credential }))).toBe(400)
  })

  it('accepts a challenge once', async () => {
    const { body } = await setUpVault()
    await call(setupCommit, body)
    expect(await status(call(setupCommit, body))).toBe(400)
  })

  it('refuses another owner\'s challenge', async () => {
    const { body } = await setUpVault()
    const other = { email: 'someone-else@example.com', act: 'human' }
    expect(await status(call(setupCommit, body, 'POST', other))).toBe(400)
  })

  it('refuses a second vault for the same owner', async () => {
    await call(setupCommit, (await setUpVault()).body)
    expect(await status(call(setupOptions))).toBe(409)
  })
})

describe('adding a second passkey', () => {
  async function addPasskey(vault: Awaited<ReturnType<typeof setUpVault>>, signWith?: ReturnType<typeof createTestAuthenticator>) {
    const opts = await call<{ challengeId: string, vaultId: string, publicKey: { challenge: string } }>(credentialOptions)
    const second = createTestAuthenticator()
    const prf = rnd(32)
    const kdfSalt = rnd(32)
    const assertion = vault.passkey.createAuthenticationResponse({
      challenge: opts.publicKey.challenge,
      origin: ORIGIN,
      rpId: RP_ID,
      signingKey: signWith?.privateKey,
    })
    return call(credentialCommit, {
      challengeId: opts.challengeId,
      assertion,
      credential: second.createRegistrationResponse({ challenge: opts.publicKey.challenge, origin: ORIGIN, rpId: RP_ID }),
      label: 'Second passkey',
      prfInput: b64u(rnd(32)),
      kdfSalt: b64u(kdfSalt),
      vmkWrap: await wrapVmk(await credentialKek(prf, kdfSalt, opts.vaultId, second.credentialId), vault.vmk, opts.vaultId, second.credentialId),
    })
  }

  it('works with a fresh assertion from an existing passkey', async () => {
    const vault = await setUpVault()
    await call(setupCommit, vault.body)
    await addPasskey(vault)
    const view = await call<{ credentials: unknown[] }>(getVault, undefined, 'GET')
    expect(view.credentials).toHaveLength(2)
  })

  it('is refused when the assertion was not signed by an existing passkey', async () => {
    const vault = await setUpVault()
    await call(setupCommit, vault.body)
    expect(await status(addPasskey(vault, createTestAuthenticator()))).toBe(400)
    const view = await call<{ credentials: unknown[] }>(getVault, undefined, 'GET')
    expect(view.credentials).toHaveLength(1)
  })
})

describe('recovery', () => {
  interface RecoveryOptions { challengeId: string, challenge: string, vaultId: string, recovery: Parameters<typeof openRecovery>[1], publicKey: { challenge: string } }

  async function recover(vault: Awaited<ReturnType<typeof setUpVault>>, secret = vault.recoverySecret) {
    const opts = await call<RecoveryOptions>(recoveryOptions)
    const replacement = createTestAuthenticator()
    const prf = rnd(32)
    const kdfSalt = rnd(32)
    let proof: string
    let vmk = newVmk()
    try {
      const opened = await openRecovery(secret, opts.recovery, opts.vaultId)
      vmk = opened.vmk
      proof = await opened.sign(opts.challenge)
    }
    catch {
      // A wrong recovery secret cannot open anything; forge a signature instead.
      proof = b64u(rnd(64))
    }
    return call(recoveryCommit, {
      challengeId: opts.challengeId,
      challenge: opts.challenge,
      proof,
      credential: replacement.createRegistrationResponse({ challenge: opts.publicKey.challenge, origin: ORIGIN, rpId: RP_ID }),
      label: 'Replacement passkey',
      prfInput: b64u(rnd(32)),
      kdfSalt: b64u(kdfSalt),
      vmkWrap: await wrapVmk(await credentialKek(prf, kdfSalt, opts.vaultId, replacement.credentialId), vmk, opts.vaultId, replacement.credentialId),
    })
  }

  it('registers a replacement passkey with the recovery secret', async () => {
    const vault = await setUpVault()
    await call(setupCommit, vault.body)
    await recover(vault)
    const view = await call<{ credentials: unknown[] }>(getVault, undefined, 'GET')
    expect(view.credentials).toHaveLength(2)
  })

  it('is refused without the recovery secret', async () => {
    const vault = await setUpVault()
    await call(setupCommit, vault.body)
    expect(await status(recover(vault, newRecoverySecret()))).toBe(400)
    const view = await call<{ credentials: unknown[] }>(getVault, undefined, 'GET')
    expect(view.credentials).toHaveLength(1)
  })
})
