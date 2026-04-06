import { useSession } from 'h3'
import { getSessionConfig } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const config = getIdPConfig()
  const session = await useSession(event, getSessionConfig(config))
  await session.clear()
  return { ok: true }
})
