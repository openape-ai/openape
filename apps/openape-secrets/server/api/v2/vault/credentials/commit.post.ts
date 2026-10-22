import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { audit, consumeChallenge, insertCredential, verifyNewPasskey, verifyVaultPasskey, wrappedCredentialFields } from '../../../../utils/vault-passkeys'

/**
 * POST /api/v2/vault/credentials/commit — store a new passkey's VMK wrapper.
 * A signed-in session alone is not enough: an existing passkey must confirm
 * this exact challenge, otherwise whoever holds the session could enrol a key.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const body = (await readBody<Record<string, unknown>>(event)) ?? {}
  const fields = wrappedCredentialFields(body)

  const result = await useDb().transaction(async (tx) => {
    const challenge = await consumeChallenge(tx, body.challengeId, owner, 'credential.add')
    const confirmedBy = await verifyVaultPasskey(tx, challenge.vaultId, body.assertion, challenge.matches)
    const passkey = await verifyNewPasskey(body.credential, challenge.matches)
    await insertCredential(tx, challenge.vaultId, passkey, fields)
    await audit(tx, { actor: owner, event: 'credential.added', vaultId: challenge.vaultId, credentialId: passkey.id })
    return { credential_id: passkey.id, confirmed_by: confirmedBy.id }
  })
  setResponseStatus(event, 201)
  return result
})
