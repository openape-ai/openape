import { tryResolveCaller } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const caller = await tryResolveCaller(event)
  if (!caller) return null
  return { email: caller.email, act: caller.act }
})
