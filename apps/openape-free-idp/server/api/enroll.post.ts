import { createHash } from 'node:crypto'
import { createError, defineEventHandler, readBody } from 'h3'

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-') || 'agent'
}

function deriveAgentEmail(ownerEmail: string, agentName: string): string {
  const [local, domain] = ownerEmail.split('@')
  const safeName = sanitizeName(agentName)
  return `${safeName}+${local}+${domain!.replace(/\./g, '_')}@id.openape.at`
}

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const config = useRuntimeConfig()
  const maxAgents = config.public.maxAgentsPerUser

  const body = await readBody<{
    name: string
    publicKey: string
  }>(event)

  if (!body.name || !body.publicKey) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: name, publicKey' })
  }

  if (!body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
  }

  const { userStore, sshKeyStore } = useIdpStores()

  const existingOwned = await userStore.findByOwner(email)
  if (existingOwned.length >= maxAgents) {
    throw createError({ statusCode: 409, statusMessage: `Agent limit reached (${maxAgents}). Delete an existing agent first.` })
  }

  const agentEmail = deriveAgentEmail(email, body.name)

  const existingByEmail = await userStore.findByEmail(agentEmail)
  if (existingByEmail) {
    throw createError({ statusCode: 409, statusMessage: 'An agent with this name already exists. Choose a different name.' })
  }

  // Create user
  const user = await userStore.create({
    email: agentEmail,
    name: body.name,
    owner: email,
    approver: email,
    type: 'agent',
    isActive: true,
    createdAt: Math.floor(Date.now() / 1000),
  })

  // Create SSH key
  const parts = body.publicKey.trim().split(/\s+/)
  const keyData = parts[1]!
  const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')
  await sshKeyStore.save({
    keyId,
    userEmail: agentEmail,
    publicKey: body.publicKey.trim(),
    name: body.name,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return {
    email: user.email,
    name: user.name,
    owner: user.owner,
    approver: user.approver,
    status: 'active',
  }
})
