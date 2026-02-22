export default defineEventHandler(async (event) => {
  const body = await readBody<{
    agent_id: string
    challenge: string
    signature: string
  }>(event)

  if (!body.agent_id || !body.challenge || !body.signature) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: agent_id, challenge, signature' })
  }

  const { agentStore, challengeStore, keyStore } = useStores()

  // Consume challenge (one-time use)
  const valid = await challengeStore.consumeChallenge(body.challenge, body.agent_id)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid, expired, or already used challenge' })
  }

  // Look up agent
  const agent = await agentStore.findById(body.agent_id)
  if (!agent || !agent.isActive) {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found or inactive' })
  }

  // Verify ed25519 signature
  const signatureBuffer = Buffer.from(body.signature, 'base64')
  const isValid = verifyEd25519Signature(agent.publicKey, body.challenge, signatureBuffer)
  if (!isValid) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  // Issue agent JWT token
  const signingKey = await keyStore.getSigningKey()
  const token = await issueAgentToken(
    {
      sub: agent.id,
      name: agent.name,
      owner: agent.owner,
      approver: agent.approver,
    },
    IDP_ISSUER,
    signingKey.privateKey,
    signingKey.kid,
  )

  return {
    token,
    agent_id: agent.id,
    name: agent.name,
    expires_in: 3600,
  }
})
