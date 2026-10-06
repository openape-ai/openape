import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const APP_PORT = 3104
export const APP_URL = `http://127.0.0.1:${APP_PORT}`
export const STORAGE_STATE = join(HERE, '.auth', 'state.json')
