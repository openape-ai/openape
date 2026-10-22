import { decode, encode } from '@openape/ape-secrets/vault'
import type { EngineCommand } from './vault-engine'

export interface Ceremony { challengeId: string, options: Record<string, unknown>, credentialId: string, input: string }

export function vaultWorker() {
  const worker = new Worker(new URL('./vault.worker.ts', import.meta.url), { type: 'module' })
  let sequence = 0
  const pending = new Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void }>()
  let timer: ReturnType<typeof setTimeout>
  let disposed = false
  const dispose = () => {
    disposed = true
    worker.terminate()
    for (const call of pending.values()) call.reject(new Error('Vault locked'))
    pending.clear()
    clearTimeout(timer)
    window.removeEventListener('pagehide', dispose)
  }
  timer = setTimeout(dispose, 300000)
  window.addEventListener('pagehide', dispose)
  worker.onmessage = (event) => {
    const call = pending.get(event.data.id)
    pending.delete(event.data.id)
    if (event.data.error) call?.reject(new Error(event.data.error))
    else call?.resolve(event.data.result)
  }
  worker.onerror = dispose
  return {
    dispose,
    call<T>(command: EngineCommand): Promise<T> {
      if (disposed) {
        if ('prf' in command) command.prf.fill(0)
        return Promise.reject(new Error('Vault locked'))
      }
      return new Promise((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve: value => resolve(value as T), reject })
        worker.postMessage({ id, command }, 'prf' in command ? [command.prf.buffer] : [])
      })
    },
  }
}

// Deliberate allowlist: never serialize getClientExtensionResults() to the API.
export function serializeCredential(credential: PublicKeyCredential) {
  const response = credential.response
  const result = { id: credential.id, rawId: encode(credential.rawId), type: credential.type, clientExtensionResults: {} }
  if ('attestationObject' in response) {
    const registration = response as AuthenticatorAttestationResponse
    return { ...result, response: { clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(registration.attestationObject), transports: registration.getTransports() } }
  }
  const assertion = response as AuthenticatorAssertionResponse
  return { ...result, response: { clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(assertion.authenticatorData), signature: encode(assertion.signature), userHandle: assertion.userHandle ? encode(assertion.userHandle) : undefined } }
}
export async function register(options: Record<string, unknown>) {
  const user = options.user as { id: string, name: string, displayName: string }
  const exclude = (options.excludeCredentials ?? []) as { id: string, type: 'public-key', transports?: AuthenticatorTransport[] }[]
  const publicKey = { ...options, challenge: decode(String(options.challenge)), user: { ...user, id: decode(user.id) }, excludeCredentials: exclude.map(c => ({ ...c, id: decode(c.id) })) } as unknown as PublicKeyCredentialCreationOptions
  const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey registration cancelled')
  return serializeCredential(credential)
}
export async function authenticate(ceremony: Ceremony) {
  const allow = (ceremony.options.allowCredentials ?? []) as { id: string, type: 'public-key', transports?: AuthenticatorTransport[] }[]
  const publicKey = { ...ceremony.options, userVerification: 'required', challenge: decode(String(ceremony.options.challenge)), allowCredentials: allow.map(c => ({ ...c, id: decode(c.id) })), extensions: { prf: { eval: { first: decode(ceremony.input) } } } } as unknown as PublicKeyCredentialRequestOptions
  const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey verification cancelled')
  const extension = credential.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
  const first = extension.prf?.results?.first
  if (!first || first.byteLength !== 32) throw new Error('This passkey/browser does not support PRF. Use a compatible passkey; no unencrypted fallback is available.')
  return { response: serializeCredential(credential), prf: new Uint8Array(first) }
}
