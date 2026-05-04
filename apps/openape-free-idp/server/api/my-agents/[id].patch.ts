import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'

const PUBLIC_KEY_MAX_LENGTH = 1000

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing user ID' })
  }

  const { userStore, sshKeyStore } = useIdpStores()
  const userEmail = decodeURIComponent(id)
  const user = await userStore.findByEmail(userEmail)

  if (!user || user.owner !== email) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  const body = await readBody<{ publicKey?: string, isActive?: boolean }>(event)

  if (body.publicKey === undefined && body.isActive === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Provide at least one of: publicKey, isActive' })
  }

  if (body.publicKey !== undefined) {
    // VALIDATE FIRST. The previous flow ran `deleteAllForUser` BEFORE
    // validating the new key, so any failure (malformed base64, missing
    // section, length overflow) left the agent with zero keys —
    // permanently locked out of `apes login`. (#295)
    if (body.publicKey.length > PUBLIC_KEY_MAX_LENGTH) {
      throw createError({ statusCode: 400, statusMessage: `Public key exceeds ${PUBLIC_KEY_MAX_LENGTH} characters` })
    }
    if (!body.publicKey.startsWith('ssh-ed25519 ')) {
      throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
    }
    const parts = body.publicKey.trim().split(/\s+/)
    if (parts.length < 2 || !parts[1]) {
      throw createError({ statusCode: 400, statusMessage: 'Public key missing base64 section' })
    }
    const keyData = parts[1]
    const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')

    // Save FIRST, then delete the others. The sshKeyStore primary key
    // is keyId, so save() doesn't conflict with the existing rows; once
    // the new row is durable we drop everything else for this user.
    // Net result: the agent is never without an authenticator.
    await sshKeyStore.save({
      keyId,
      userEmail,
      publicKey: body.publicKey.trim(),
      name: user.name,
      createdAt: Math.floor(Date.now() / 1000),
    })
    await sshKeyStore.deleteAllForUser(userEmail, { exceptKeyId: keyId })
  }

  if (body.isActive !== undefined) {
    await userStore.update(userEmail, { isActive: !!body.isActive })
  }

  return await userStore.findByEmail(userEmail)
})
