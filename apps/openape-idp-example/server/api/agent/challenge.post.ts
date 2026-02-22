export default defineEventHandler(async (event) => {
  const body = await readBody<{ agent_id: string }>(event)

  if (!body.agent_id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required field: agent_id' })
  }

  const { agentStore, challengeStore } = useStores()

  const agent = await agentStore.findById(body.agent_id)
  if (!agent || !agent.isActive) {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found or inactive' })
  }

  const challenge = await challengeStore.createChallenge(body.agent_id)
  return { challenge }
})
