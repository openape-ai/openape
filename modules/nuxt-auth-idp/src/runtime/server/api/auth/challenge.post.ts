// Canonical: @openape/server createChallengeHandler
import { defineEventHandler, readBody } from 'h3'
import { useIdpStores } from '../../utils/stores'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)

  if (!body.id) {
    throw createProblemError({ status: 400, title: 'Missing required field: id' })
  }

  const { userStore, sshKeyStore } = useIdpStores()
  const { challengeStore } = useGrantStores()

  // Look up user
  const user = await userStore.findByEmail(body.id)
  if (user && user.isActive) {
    // Check if user has SSH keys
    const sshKeys = await sshKeyStore.findByUser(body.id)
    if (sshKeys.length > 0) {
      const challenge = await challengeStore.createChallenge(body.id)
      return { challenge }
    }
  }

  // Try SSH keys directly (covers case where user exists in sshKeyStore but not userStore)
  const sshKeys = await sshKeyStore.findByUser(body.id)
  if (sshKeys.length > 0) {
    const challenge = await challengeStore.createChallenge(body.id)
    return { challenge }
  }

  throw createProblemError({ status: 404, title: 'No user with SSH keys found for this identity' })
})
