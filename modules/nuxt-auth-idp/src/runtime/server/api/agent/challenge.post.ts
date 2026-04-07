// Legacy alias — maps agent_id to id, delegates to /api/auth/challenge
import { defineEventHandler, readBody } from 'h3'
import { useIdpStores } from '../../utils/stores'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ agent_id: string }>(event)

  if (!body.agent_id) {
    throw createProblemError({ status: 400, title: 'Missing required field: agent_id' })
  }

  const { sshKeyStore } = useIdpStores()
  const { challengeStore } = useGrantStores()

  const id = body.agent_id
  const sshKeys = await sshKeyStore.findByUser(id)
  if (sshKeys.length === 0) {
    throw createProblemError({ status: 404, title: 'User not found or has no SSH keys' })
  }

  const challenge = await challengeStore.createChallenge(id)
  return { challenge }
})
