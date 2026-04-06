/**
 * Legacy alias: POST /api/agent/challenge -> same logic as /api/auth/challenge
 * Maps `agent_id` to `id` for backward compatibility.
 */
export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const body = await readBody<{ id?: string, agent_id?: string }>(event)

  const id = body.id || body.agent_id
  if (!id) {
    throw createProblemError({ status: 400, title: 'Missing required field: id or agent_id' })
  }

  const user = await stores.userStore.findByEmail(id)
  if (user && user.isActive) {
    const challenge = await stores.challengeStore.createChallenge(user.email)
    return { challenge }
  }

  // Try user with SSH keys
  const sshKeys = await stores.sshKeyStore.findByUser(id)
  if (sshKeys.length > 0) {
    const challenge = await stores.challengeStore.createChallenge(id)
    return { challenge }
  }

  throw createProblemError({ status: 404, title: 'No user with SSH keys found for this identity' })
})
