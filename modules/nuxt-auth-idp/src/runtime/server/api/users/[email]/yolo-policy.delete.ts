import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { requireYoloPolicyActor } from '../../../utils/yolo-policy-auth'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const email = decodeURIComponent(getRouterParam(event, 'email') || '')
  if (!email) throw createProblemError({ status: 400, title: 'Email is required' })

  await requireYoloPolicyActor(event, email)
  const { yoloPolicyStore } = useIdpStores()
  await yoloPolicyStore.delete(email)
  setResponseStatus(event, 204)
  return null
})
