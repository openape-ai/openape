import { defineEventHandler, readBody } from 'h3'
import { useIdpStores } from '../../utils/stores'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)

  if (!body.id) {
    throw createProblemError({ status: 400, title: 'Missing required field: id' })
  }

  const { agentStore, sshKeyStore } = useIdpStores()
  const { challengeStore } = useGrantStores()

  // Try agent first (by email or UUID)
  const agent = body.id.includes('@')
    ? await agentStore.findByEmail(body.id)
    : await agentStore.findById(body.id)

  if (agent && agent.isActive) {
    const challenge = await challengeStore.createChallenge(agent.id)
    return { challenge }
  }

  // Try human user with SSH keys
  const sshKeys = await sshKeyStore.findByUser(body.id)
  if (sshKeys.length > 0) {
    const challenge = await challengeStore.createChallenge(body.id)
    return { challenge }
  }

  throw createProblemError({ status: 404, title: 'No agent or user with SSH keys found for this identity' })
})
