import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { agentStore } = useIdpStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Agent ID is required' })
  }

  const body = await readBody<{
    email?: string
    name?: string
    owner?: string
    approver?: string
    publicKey?: string
    isActive?: boolean
  }>(event)

  if (body.publicKey && !body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createProblemError({ status: 400, title: 'Public key must be in ssh-ed25519 format' })
  }

  const existing = await agentStore.findById(id)
  if (!existing) {
    throw createProblemError({ status: 404, title: 'Agent not found' })
  }

  const update: Record<string, unknown> = {}
  if (body.email !== undefined)
    update.email = body.email
  if (body.name !== undefined)
    update.name = body.name
  if (body.owner !== undefined)
    update.owner = body.owner
  if (body.approver !== undefined)
    update.approver = body.approver
  if (body.publicKey !== undefined)
    update.publicKey = body.publicKey
  if (body.isActive !== undefined)
    update.isActive = body.isActive

  const agent = await agentStore.update(id, update)
  return agent
})
