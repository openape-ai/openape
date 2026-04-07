import { createHash } from 'node:crypto'
import { defineEventHandler, readBody } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { userStore, sshKeyStore } = useIdpStores()

  const body = await readBody<{
    email: string
    name: string
    owner: string
    approver: string
    publicKey: string
  }>(event)

  if (!body.email || !body.name || !body.owner || !body.approver || !body.publicKey) {
    throw createProblemError({ status: 400, title: 'Missing required fields: email, name, owner, approver, publicKey' })
  }

  if (!body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createProblemError({ status: 400, title: 'Public key must be in ssh-ed25519 format' })
  }

  const duplicate = await userStore.findByEmail(body.email)
  if (duplicate) {
    throw createProblemError({ status: 409, title: 'A user with this email already exists' })
  }

  const user = await userStore.create({
    email: body.email,
    name: body.name,
    owner: body.owner,
    approver: body.approver,
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
    userEmail: body.email,
    publicKey: body.publicKey.trim(),
    name: body.name,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return user
})
