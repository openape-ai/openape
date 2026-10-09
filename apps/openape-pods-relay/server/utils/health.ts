import { useRuntimeConfig } from 'nitropack/runtime'
import { workspace } from './workspace'
import { relay } from './service'

export function health() {
  const enabled = !!useRuntimeConfig().relayEnabled
  const workspaceEnabled = !!useRuntimeConfig().workspaceEnabled
  if (workspaceEnabled) workspace().db.prepare('SELECT 1').get()
  if (enabled) relay().db.prepare('SELECT 1').get()
  return { ok: true, service: 'openape-pods-relay', protocol: 1, enabled, workspaceEnabled }
}
