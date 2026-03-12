import type { H3Event } from 'h3'
import { useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

export async function getSpSession(event: H3Event) {
  const config = useRuntimeConfig()
  return await useSession(event, {
    name: 'openape-sp',
    password: config.openapeSp.sessionSecret,
  })
}
