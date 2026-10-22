import { authenticate, register } from './vault-browser'
import { decode, encode, randomKey } from '@openape/ape-secrets/vault'

/** Interactive diagnostic only; no server calls and no output keys retained. */
export async function checkPrf() {
  const registration = await register({
    challenge: encode(randomKey()),
    rp: { id: location.hostname, name: 'OpenApe Secrets PRF diagnostic' },
    user: { id: encode(randomKey()), name: `prf-check-${Date.now()}`, displayName: 'Temporary PRF compatibility test' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
    attestation: 'none',
    extensions: { prf: {} },
  })
  const input = encode(randomKey())
  const values: Uint8Array<ArrayBuffer>[] = []
  try {
    for (const first of [input, input, encode(randomKey())]) {
      const result = await authenticate({ challengeId: 'local-diagnostic', credentialId: registration.id, input: first, options: { challenge: encode(randomKey()), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: registration.id }] } })
      values.push(result.prf)
      if (!('authenticatorData' in result.response.response) || !(decode(String(result.response.response.authenticatorData))[32]! & 4)) throw new Error('User verification was not confirmed')
    }
    const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
    if (!equal(values[0]!, values[1]!) || equal(values[0]!, values[2]!)) throw new Error('PRF was not stable or did not separate inputs')
    return { status: 'passed', origin: location.origin, checkedAt: new Date().toISOString(), userAgent: navigator.userAgent, userVerification: true, stablePrf: true, distinctInputs: true }
  }
  finally { for (const value of values) value.fill(0) }
}
