export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { agentStore } = useStores()

  const body = await readBody<{
    name: string
    owner: string
    approver: string
    publicKey: string
  }>(event)

  if (!body.name || !body.owner || !body.approver || !body.publicKey) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: name, owner, approver, publicKey' })
  }

  if (!body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
  }

  const agent = await agentStore.create({
    id: crypto.randomUUID(),
    name: body.name,
    owner: body.owner,
    approver: body.approver,
    publicKey: body.publicKey,
    createdAt: Date.now(),
    isActive: true,
  })

  return agent
})
