export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const body = await readBody<{ id: string }>(event)

  if (!body.id) {
    throw createProblemError({ status: 400, title: 'Missing required field: id' })
  }

  const user = await stores.userStore.findByEmail(body.id)
  if (user && user.isActive) {
    const challenge = await stores.challengeStore.createChallenge(user.email)
    return { challenge }
  }

  // Try user with SSH keys
  const sshKeys = await stores.sshKeyStore.findByUser(body.id)
  if (sshKeys.length > 0) {
    const challenge = await stores.challengeStore.createChallenge(body.id)
    return { challenge }
  }

  throw createProblemError({ status: 404, title: 'No user with SSH keys found for this identity' })
})
