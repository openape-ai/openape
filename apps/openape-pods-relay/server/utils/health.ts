import { useRuntimeConfig } from 'nitropack/runtime'
import { relay } from './service'

export function health() {
  const enabled = !!useRuntimeConfig().relayEnabled
  if (enabled) relay().db.prepare('SELECT 1').get()
  return { ok: true, service: 'openape-pods-relay', protocol: 1, enabled }
}
