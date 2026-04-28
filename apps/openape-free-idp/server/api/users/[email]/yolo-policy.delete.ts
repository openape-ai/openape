import { defineEventHandler, getQuery, getRouterParam, setResponseStatus } from 'h3'
import { requireYoloPolicyActor } from '../../../utils/yolo-policy-auth'
import { AUDIENCE_WILDCARD, useYoloPolicyStore } from '../../../utils/yolo-policy-store'

export default defineEventHandler(async (event) => {
  const email = decodeURIComponent(getRouterParam(event, 'email') || '')
  if (!email) throw createProblemError({ status: 400, title: 'Email is required' })

  await requireYoloPolicyActor(event, email)
  // Audience scope: defaults to the wildcard. Pass `?audience=ape-proxy` to
  // remove only the per-audience override and keep the wildcard fallback.
  const audience = (getQuery(event).audience as string | undefined)?.trim() || AUDIENCE_WILDCARD
  await useYoloPolicyStore().delete(email, audience)
  setResponseStatus(event, 204)
  return null
})
