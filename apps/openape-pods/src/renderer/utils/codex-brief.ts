import type { MapView } from '../../contracts/map-view'
import { t } from '../i18n'

/**
 * The brief Codex receives for a new automation, as the mock's `codexPrompt` builds it: the group,
 * the pinned system or Pod as starting point, and the order to show shape, map, access and the
 * example checks first, create afterwards, activate only as a preview and request rights only
 * through Permissions and the identity provider.
 */
export function codexBrief(view: MapView, pinned: string | null, group: string | null): string {
  const parts = [group ? t('Create a new automation in the group {group}.', { group }) : t('Create a new automation.')]
  const system = pinned ? view.systems.find(item => item.id === pinned) : null
  const pod = pinned ? view.pods.find(item => item.id === pinned) : null
  if (system) {
    const writes = view.edges.some(edge => edge.type === 'write' && edge.to === system.id) && !view.edges.some(edge => edge.type === 'read' && edge.from === system.id)
    parts.push(t('Starting point: {name} ({direction}).', { name: system.name, direction: t(writes ? 'write' : 'read') }))
  }
  if (pod) parts.push(t('Like {name}, but with another source.', { name: pod.name }))
  parts.push(t('Show me first the shape (Pod or network), the map, the access it needs and the examples you use as checks. Create only afterwards, activate only as a preview, and request rights exclusively through Permissions and the identity provider.'))
  return parts.join(' ')
}
