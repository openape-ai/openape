import { createTestAuthenticator } from '../../../../packages/auth/src/__tests__/webauthn-test-authenticator'
import { b64u, createRecovery, credentialKek, newRecoverySecret, newVmk, wrapVmk } from '../../shared/vault-crypto'

// Shared plumbing for the vault route tests. WebAuthn responses come from the
// repository's software authenticator and go through real verification; only
// HTTP and session handling are stubbed.

export const ORIGIN = 'https://secrets.test'
export const RP_ID = 'secrets.test'

export interface Caller { email?: string, act?: string, origin?: string, bearerOnly?: boolean }

type Handler = (e: never) => Promise<unknown>

export const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))

/** h3 as the handlers see it: reads come from the fake event. */
export function h3Mock() {
  return {
    defineEventHandler: (fn: unknown) => fn,
    readBody: async (e: { __body: unknown }) => e.__body,
    getHeader: (e: { __headers?: Record<string, string> }, name: string) => e.__headers?.[name.toLowerCase()],
    getMethod: (e: { __method?: string }) => e.__method ?? 'GET',
    getRouterParam: (e: { context: { params: Record<string, string> } }, k: string) => e.context.params[k],
    setResponseHeader: () => {},
    setResponseStatus: () => {},
    createError: (opts: { statusCode: number, statusMessage?: string, data?: unknown }) =>
      Object.assign(new Error(opts.statusMessage ?? 'error'), { statusCode: opts.statusCode, data: opts.data }),
  }
}

export function caller(): Caller {
  return { email: `owner-${Math.random().toString(36).slice(2)}@example.com`, act: 'human' }
}

export function call<T>(handler: unknown, who: Caller, body?: unknown, method = 'POST', params: Record<string, string> = {}): Promise<T> {
  const session = who.bearerOnly ? {} : { claims: { email: who.email, act: who.act } }
  const headers: Record<string, string> = { origin: who.origin ?? ORIGIN }
  return (handler as Handler)({ __body: body, __method: method, __headers: headers, __session: session, context: { params } } as never) as Promise<T>
}

export async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p
    return 200
  }
  catch (err) {
    return (err as { statusCode?: number }).statusCode ?? 500
  }
}

export interface SetupOptions { challengeId: string, vaultId: string, publicKey: { challenge: string } }

/** What the owner's browser sends to create a vault, with a software passkey and a simulated PRF output. */
export async function vaultSetupBody(opts: SetupOptions) {
  const passkey = createTestAuthenticator()
  const prf = rnd(32)
  const kdfSalt = rnd(32)
  const vmk = newVmk()
  const recoverySecret = newRecoverySecret()
  const kek = await credentialKek(prf, kdfSalt, opts.vaultId, passkey.credentialId)
  const body = {
    challengeId: opts.challengeId,
    credential: passkey.createRegistrationResponse({ challenge: opts.publicKey.challenge, origin: ORIGIN, rpId: RP_ID }),
    label: 'Test passkey',
    prfInput: b64u(rnd(32)),
    kdfSalt: b64u(kdfSalt),
    vmkWrap: await wrapVmk(kek, vmk, opts.vaultId, passkey.credentialId),
    recovery: await createRecovery(vmk, recoverySecret, opts.vaultId),
  }
  return { passkey, prf, kdfSalt, vmk, recoverySecret, body }
}

export const VAULT_TABLE_NAMES = ['secret_audit_events', 'webauthn_challenges', 'vault_secret_versions', 'vault_secrets', 'vault_recovery', 'vault_credentials', 'vaults']
