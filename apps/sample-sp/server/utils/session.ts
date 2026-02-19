import type { H3Event } from 'h3'

export async function getSession(event: H3Event) {
  const config = useRuntimeConfig()
  return await useSession(event, {
    name: 'dns-id-sp',
    password: config.sessionSecret,
  })
}
