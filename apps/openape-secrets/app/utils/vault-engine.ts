import type { DeliveryContext, SecretPayload, WrappedKey } from '@openape/ape-secrets/vault'
import { bytes, credentialBinding, decode, decryptSecret, encode, encryptSecret, randomKey, recoveryBinding, sealDelivery, unwrapData, unwrapVault, wrapData, wrapVault } from '@openape/ape-secrets/vault'

export interface Recovery { id: string, publicKey: JsonWebKey, wrapper: WrappedKey, privateKey: WrappedKey }
export type EngineCommand =
  | { type: 'setup', owner: string, credentialId: string, prf: Uint8Array<ArrayBuffer> }
  | { type: 'unlock', owner: string, credentialId: string, prf: Uint8Array<ArrayBuffer>, wrapper: WrappedKey }
  | { type: 'wrap', owner: string, credentialId: string, prf: Uint8Array<ArrayBuffer> }
  | { type: 'read', owner: string, secretId: string, version: number, payload: SecretPayload }
  | { type: 'save', value: string, owner: string, secretId: string, version: number }
  | { type: 'seal', value?: string, payload?: SecretPayload, key: JsonWebKey, descriptor: DeliveryContext }
  | { type: 'recover', code: string, owner: string, recovery: Recovery, challengeId: string, challenge: string }
  | { type: 'clear' }

/** Lives only in a dedicated worker; one ceremony, then terminate it. */
export function createVaultEngine() {
  let vmk: Uint8Array<ArrayBuffer> | undefined
  return async (command: EngineCommand): Promise<unknown> => {
    if (command.type === 'clear') { vmk?.fill(0); vmk = undefined; return null }
    if (command.type === 'setup') {
      vmk?.fill(0); vmk = randomKey()
      const recoveryKey = randomKey()
      const recoveryId = crypto.randomUUID()
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      const privateBytes = bytes(JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)))
      try {
        return {
          code: encode(recoveryKey),
          wrapper: await wrapVault(vmk, command.prf, credentialBinding(command.owner, command.credentialId)),
          recovery: {
            id: recoveryId,
            publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
            wrapper: await wrapVault(vmk, recoveryKey, recoveryBinding(command.owner, recoveryId, 'vault')),
            privateKey: await wrapData(privateBytes, recoveryKey, recoveryBinding(command.owner, recoveryId, 'signing')),
          },
        }
      }
      finally { command.prf.fill(0); recoveryKey.fill(0); privateBytes.fill(0) }
    }
    if (command.type === 'unlock') {
      vmk?.fill(0); vmk = undefined
      try { vmk = await unwrapVault(command.wrapper, command.prf, credentialBinding(command.owner, command.credentialId)); return null }
      finally { command.prf.fill(0) }
    }
    if (command.type === 'recover') {
      const key = decode(command.code)
      let privateBytes: Uint8Array<ArrayBuffer> | undefined
      try {
        vmk?.fill(0); vmk = undefined
        vmk = await unwrapVault(command.recovery.wrapper, key, recoveryBinding(command.owner, command.recovery.id, 'vault'))
        privateBytes = await unwrapData(command.recovery.privateKey, key, recoveryBinding(command.owner, command.recovery.id, 'signing'))
        const signer = await crypto.subtle.importKey('jwk', JSON.parse(new TextDecoder().decode(privateBytes)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
        return encode(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, bytes(JSON.stringify(['openape.recovery/2', command.owner, command.challengeId, command.challenge]))))
      }
      finally { key.fill(0); privateBytes?.fill(0) }
    }
    if (!vmk) throw new Error('Unlock required')
    if (command.type === 'wrap') {
      try { return await wrapVault(vmk, command.prf, credentialBinding(command.owner, command.credentialId)) }
      finally { command.prf.fill(0) }
    }
    if (command.type === 'read') {
      const value = await decryptSecret(vmk, command.payload, command.owner, command.secretId, command.version)
      try { return new TextDecoder().decode(value) }
      finally { value.fill(0) }
    }
    if (command.type === 'save') return encryptSecret(vmk, command.value, command.owner, command.secretId, command.version)
    if (command.type === 'seal') {
      const d = command.descriptor
      const value = command.payload ? await decryptSecret(vmk, command.payload, d.owner, d.secretId, d.version) : bytes(command.value ?? '')
      try { return await sealDelivery(command.key, value, d) }
      finally { value.fill(0) }
    }
    throw new Error('Unknown operation')
  }
}
