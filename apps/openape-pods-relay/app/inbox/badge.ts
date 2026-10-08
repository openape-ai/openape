import { watch } from 'vue'
import type { Inbox } from './client'

interface Badging {
  setAppBadge?: (count: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export function watchInboxBadge(inbox: Inbox, navigator: Badging) {
  return watch(
    () => [inbox.state.phase, inbox.state.syncing, inbox.state.syncedAt, inbox.state.syncError, inbox.badgeCount.value] as const,
    async ([phase, syncing, syncedAt, syncError, count]) => {
      if (!navigator.setAppBadge || !navigator.clearAppBadge) return
      if (syncing) return
      if (phase !== 'signedOut' && (phase !== 'ready' || syncedAt === null || syncError)) return
      try {
        if (phase === 'signedOut' || count === 0) await navigator.clearAppBadge()
        else await navigator.setAppBadge(count)
      }
      catch (error) { console.error('Inbox badge update failed', error) }
    },
    { immediate: true },
  )
}
