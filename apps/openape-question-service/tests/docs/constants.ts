import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const APP_PORT = 3117
export const APP_URL = `http://127.0.0.1:${APP_PORT}`

export const STORAGE_STATE = join(HERE, '.auth', 'asker.json')

/**
 * The service-agent signs in like a person. `resolveServiceAgent` only asks
 * `requireCaller` who is calling and compares the address against
 * NUXT_AGENT_SERVICE_EMAIL — a session cookie satisfies that just as well as a
 * bearer token, so the documented answer comes from the real queue rather than
 * from a stubbed endpoint.
 */
export const AGENT_STORAGE_STATE = join(HERE, '.auth', 'agent.json')

export const AGENT_USER = {
  email: 'agent@example.com',
  password: 'q1w2e3r4',
  name: 'Service Agent',
}
