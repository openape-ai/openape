import { createHash } from 'node:crypto'
import { defineEventHandler, readBody } from 'h3'
import { getAppSession } from '../../utils/session'
import { useIdpStores } from '../../utils/stores'
import { sshEd25519ToKeyObject } from '../../utils/ed25519'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  const email = session.data.userId as string | undefined
  if (!email) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const body = await readBody<{ publicKey: string, name?: string }>(event)
  if (!body.publicKey || typeof body.publicKey !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing required field: publicKey' })
  }

  const trimmedKey = body.publicKey.trim()

  // Validate ssh-ed25519 format
  try {
    sshEd25519ToKeyObject(trimmedKey)
  }
  catch {
    throw createProblemError({ status: 400, title: 'Invalid SSH key. Must be ssh-ed25519 format (paste the contents of ~/.ssh/id_ed25519.pub).' })
  }

  const parts = trimmedKey.split(/\s+/)
  const comment = parts.length >= 3 ? parts.slice(2).join(' ') : undefined
  const name = body.name || comment || 'SSH Key'

  const keyData = parts[1]!
  const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')

  const { sshKeyStore } = useIdpStores()

  const existing = await sshKeyStore.findByPublicKey(trimmedKey)
  if (existing) {
    throw createProblemError({ status: 409, title: 'This SSH key is already registered' })
  }

  const sshKey = {
    keyId,
    userEmail: email,
    publicKey: trimmedKey,
    name,
    createdAt: Math.floor(Date.now() / 1000),
  }

  await sshKeyStore.save(sshKey)
  return sshKey
})
