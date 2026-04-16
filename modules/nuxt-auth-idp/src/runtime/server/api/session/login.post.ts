import { defineEventHandler, readBody } from 'h3'
import { useIdpStores } from '../../utils/stores'
import { useGrantStores } from '../../utils/grant-stores'
import { verifyEd25519Signature } from '../../utils/ed25519'
import { verifySSHSignature } from '../../utils/sshsig'
import { getAppSession } from '../../utils/session'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string
    challenge: string
    signature: string
    public_key?: string
  }>(event)

  if (!body.id || !body.challenge || !body.signature) {
    throw createProblemError({ status: 400, title: 'Missing required fields: id, challenge, signature' })
  }

  const { sshKeyStore, userStore } = useIdpStores()
  const { challengeStore } = useGrantStores()

  // Find SSH key(s) to verify against
  let keys
  if (body.public_key) {
    const sshKey = await sshKeyStore.findByPublicKey(body.public_key)
    if (!sshKey || sshKey.userEmail !== body.id) {
      throw createProblemError({ status: 404, title: 'SSH key not found for this user' })
    }
    keys = [sshKey]
  }
  else {
    keys = await sshKeyStore.findByUser(body.id)
    if (keys.length === 0) {
      throw createProblemError({ status: 404, title: 'No user with SSH keys found' })
    }
  }

  // Verify user exists
  const user = await userStore.findByEmail(body.id)
  if (!user) {
    throw createProblemError({ status: 404, title: 'User not found' })
  }

  const valid = await challengeStore.consumeChallenge(body.challenge, body.id)
  if (!valid) {
    throw createProblemError({ status: 401, title: 'Invalid, expired, or already used challenge' })
  }

  // Try each registered key until one verifies
  const signatureStr = body.signature.trim()
  const isSSHSIG = signatureStr.startsWith('-----BEGIN SSH SIGNATURE-----')
  let isValid = false
  for (const key of keys) {
    if (isSSHSIG) {
      isValid = verifySSHSignature(key.publicKey, body.challenge, signatureStr, 'openape')
    }
    else {
      const signatureBuffer = Buffer.from(signatureStr, 'base64')
      isValid = verifyEd25519Signature(key.publicKey, body.challenge, signatureBuffer)
    }
    if (isValid) break
  }
  if (!isValid) {
    throw createProblemError({ status: 401, title: 'Invalid signature', type: 'https://ddisa.org/errors/invalid_token' })
  }

  const session = await getAppSession(event)
  await session.update({ userId: user.email })

  return { ok: true }
})
