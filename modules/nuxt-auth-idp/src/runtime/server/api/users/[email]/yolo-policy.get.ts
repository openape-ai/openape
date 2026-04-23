import { defineEventHandler, getRouterParam } from 'h3'
import { requireYoloPolicyActor } from '../../../utils/yolo-policy-auth'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const email = decodeURIComponent(getRouterParam(event, 'email') || '')
  if (!email) throw createProblemError({ status: 400, title: 'Email is required' })

  await requireYoloPolicyActor(event, email)
  const { yoloPolicyStore } = useIdpStores()
  const policy = await yoloPolicyStore.get(email)
  // Wrapped so null renders as a JSON body (h3 returns 204 for bare-null returns).
  return { policy }
})
