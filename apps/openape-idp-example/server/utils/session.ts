import type { H3Event } from 'h3'

export async function getAppSession(event: H3Event) {
  const config = useRuntimeConfig()
  return await useSession(event, {
    name: 'dns-id-server',
    password: config.sessionSecret,
  })
}
