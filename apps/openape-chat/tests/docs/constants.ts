import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const APP_PORT = 3107
export const APP_URL = `http://127.0.0.1:${APP_PORT}`

/**
 * Two signed-in browsers, because a conversation needs someone on the other
 * end: the documented flows show a contact request being answered and a
 * message arriving, neither of which one account can demonstrate alone.
 */
export const STORAGE_STATE = join(HERE, '.auth', 'ada.json')
export const PEER_STORAGE_STATE = join(HERE, '.auth', 'bruno.json')

export const PEER_USER = {
  email: 'bruno@example.com',
  password: 'q1w2e3r4',
  name: 'Bruno Weiss',
}
