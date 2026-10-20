import type { MapView } from '../../contracts/map-view'
import { t } from '../i18n'

/**
 * The brief Codex receives for a new automation, as the mock's `codexPrompt` builds it: the tags,
 * the pinned system or Pod as starting point, and the order to show shape, map, access and the
 * example checks first, create afterwards, activate only as a preview and request rights only
 * through Permissions and the identity provider.
 */
export function codexBrief(view: MapView, pinned: string | null, tags: string[]): string {
  const parts = [tags.length ? t('Create a new automation with the tags {tags}.', { tags: tags.map(tag => `#${tag}`).join(', ') }) : t('Create a new automation.')]
  const system = pinned ? view.systems.find(item => item.id === pinned) : null
  const pod = pinned ? view.pods.find(item => item.id === pinned) : null
  if (system) {
    const writes = view.edges.some(edge => edge.type === 'write' && edge.to === system.id) && !view.edges.some(edge => edge.type === 'read' && edge.from === system.id)
    parts.push(t('Starting point: {name} ({direction}).', { name: system.name, direction: t(writes ? 'write' : 'read') }))
  }
  if (pod) parts.push(t('Like {name}, but with another source.', { name: pod.name }))
  parts.push(t('Show me first the tasks, the files or external services they use, the map, the access they need and the examples you use as checks. Create only afterwards, activate only as a preview, and request rights exclusively through Permissions and the identity provider.'))
  return parts.join(' ')
}
