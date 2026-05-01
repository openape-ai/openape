/// <reference lib="webworker" />

// Service worker for the OpenApe IdP. We use injectManifest so we own this
// file and can register `push` + `notificationclick` handlers — vite-pwa's
// generateSW mode doesn't expose those.
//
// Caching strategy mirrors apps/openape-chat: NetworkFirst for HTML and
// /api/**, CacheFirst for /_nuxt/** (filenames are hashed on every build,
// so cache hits are always for the right version).

import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string, revision: string | null }> }

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST ?? [])

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 })],
  }),
)

registerRoute(
  ({ url }) => url.pathname.startsWith('/_nuxt/'),
  new CacheFirst({
    cacheName: 'nuxt-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
)

registerRoute(
  ({ request }) => request.destination === 'document',
  new NetworkFirst({
    cacheName: 'html-cache',
    networkTimeoutSeconds: 3,
  }),
)

// ---------------------------------------------------------------------------
// Push notifications — only fire when the IdP is installed as a PWA
// (display-mode: standalone). Subscriptions are never created on a normal
// browser tab, so we don't need a runtime guard here.
// ---------------------------------------------------------------------------

interface PushPayload {
  type?: string
  grant_id?: string
  title?: string
  body?: string
  deep_link?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  try {
    if (event.data) data = event.data.json() as PushPayload
  }
  catch {
    // Some push services deliver an empty payload to wake the SW; show a
    // generic notification rather than swallow it.
    data = { title: 'OpenApe IdP', body: 'New activity' }
  }

  const title = data.title ?? 'Approval needed'
  const body = data.body ?? 'A grant is waiting for your approval.'
  // Coalesce multiple pushes for the same grant into one notification —
  // re-sends (e.g. retries by web-push when the device was offline) won't
  // pile up four copies on the lock screen.
  const tag = data.grant_id ? `grant:${data.grant_id}` : 'openape-idp'

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data as PushPayload | undefined
  const target = data?.deep_link ?? '/'

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // If a window is already open at the right URL, focus it; otherwise
    // navigate the first available window or open a new one.
    for (const client of clientsList) {
      try {
        const url = new URL(client.url)
        if (url.pathname + url.search === target) {
          await client.focus()
          return
        }
      }
      catch { /* unparseable client URL — ignore */ }
    }
    if (clientsList.length > 0) {
      const first = clientsList[0]
      if ('navigate' in first && typeof first.navigate === 'function') {
        await first.navigate(target)
        await first.focus()
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})

self.addEventListener('install', () => {
  // Activate the new SW immediately on install so users see fresh behaviour
  // on their next reload (not the one after that).
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
