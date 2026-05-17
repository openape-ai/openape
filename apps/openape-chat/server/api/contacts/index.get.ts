import { resolveCaller } from '../../utils/auth'
import { listContactsFor } from '../../utils/contacts'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  return await listContactsFor(caller.email)
})
