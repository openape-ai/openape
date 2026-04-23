import { defineEventHandler, getRouterParam } from 'h3'
import { requireYoloPolicyActor } from '../../../utils/yolo-policy-auth'
import { useYoloPolicyStore } from '../../../utils/yolo-policy-store'

export default defineEventHandler(async (event) => {
  const email = decodeURIComponent(getRouterParam(event, 'email') || '')
  if (!email) throw createProblemError({ status: 400, title: 'Email is required' })

  await requireYoloPolicyActor(event, email)
  const policy = await useYoloPolicyStore().get(email)
  return { policy }
})
