import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useGrantStores } from '../../../utils/grant-stores'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { grantStore } = useGrantStores()
  const allGrants = await grantStore.findAll()
  return allGrants.filter(g => g.type === 'delegation')
})
