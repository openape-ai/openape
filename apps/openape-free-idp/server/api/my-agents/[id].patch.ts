import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'

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
    if (!body.publicKey.startsWith('ssh-ed25519 ')) {
      throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
    }
    await sshKeyStore.deleteAllForUser(userEmail)
    const { createHash } = await import('node:crypto')
    const parts = body.publicKey.trim().split(/\s+/)
    const keyData = parts[1]!
    const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')
    await sshKeyStore.save({
      keyId,
      userEmail,
      publicKey: body.publicKey.trim(),
      name: user.name,
      createdAt: Math.floor(Date.now() / 1000),
    })
  }

  if (body.isActive !== undefined) {
    await userStore.update(userEmail, { isActive: !!body.isActive })
  }

  return await userStore.findByEmail(userEmail)
})
