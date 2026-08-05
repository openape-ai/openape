import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IDP_PORT } from 'openape-e2e/constants'

const HERE = dirname(fileURLToPath(import.meta.url))

// The documented app is the IdP itself, and openape-e2e's helpers address it
// through their own constants — so it has to run on their port.
export const APP_PORT = IDP_PORT
// `localhost`, not 127.0.0.1: WebAuthn rejects a bare IP as a relying-party ID
// ("127.0.0.1 is an invalid domain"), and localhost is the one hostname that
// counts as a secure context without TLS. The server binds to both.
export const APP_URL = `http://localhost:${IDP_PORT}`
export const STORAGE_STATE = join(HERE, '.auth', 'state.json')
