import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { requireYoloPolicyActor } from '../../../utils/yolo-policy-auth'
import { useYoloPolicyStore } from '../../../utils/yolo-policy-store'

export default defineEventHandler(async (event) => {
  const email = decodeURIComponent(getRouterParam(event, 'email') || '')
  if (!email) throw createProblemError({ status: 400, title: 'Email is required' })

  await requireYoloPolicyActor(event, email)
  await useYoloPolicyStore().delete(email)
  setResponseStatus(event, 204)
  return null
})
