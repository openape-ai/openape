/// <reference lib="webworker" />

// Service worker for OpenApe Chat. We use injectManifest so we own this
// file and can register `push` + `notificationclick` handlers — vite-pwa's
// generateSW mode doesn't expose those.
//
// Caching strategy is the same as the v1 SW (PR 2): NetworkFirst for HTML
// and /api/**, CacheFirst for /_nuxt/** (hashed filenames make this safe).

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
// Push notifications — only fire when the app is installed (display-mode:
// standalone). On non-installed tabs the push subscription is never created
// in the first place, so we don't need a runtime guard here.
// ---------------------------------------------------------------------------

interface PushPayload {
  type?: string
  room_id?: string
  title?: string
  body?: string
  sender?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  try {
    if (event.data) data = event.data.json() as PushPayload
  }
  catch {
    // Some push services deliver an empty payload to wake the SW; show a
    // generic notification rather than swallow it.
    data = { title: 'OpenApe Chat', body: 'New activity' }
  }

  const title = data.title ?? `${data.sender ?? 'Someone'} in OpenApe Chat`
  const body = data.body ?? 'New message'
  const tag = data.room_id ? `room:${data.room_id}` : 'openape-chat'

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag, // collapse multiple pushes for the same room into one notification
    icon: '/icon.svg',
    badge: '/icon.svg',
    data,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data as PushPayload | undefined
  const target = data?.room_id ? `/rooms/${data.room_id}` : '/'

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // If a window is already open at the right URL, focus it; otherwise
    // open a new one. Falls back to focusing any open window if the URL
    // can't be opened (e.g. file: scheme).
    for (const client of clientsList) {
      try {
        const url = new URL(client.url)
        if (url.pathname === target) {
          await client.focus()
          return
        }
      }
      catch { /* unparseable client URL — ignore */ }
    }
    if (clientsList.length > 0) {
      // Navigate the first available window to the target.
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

// ---------------------------------------------------------------------------
// pushsubscriptionchange — fires when the push service (FCM, APNs, Mozilla)
// invalidates or rotates the subscription. Without this handler the
// subscription silently dies: the server's 404/410 cleanup prunes the row,
// the page-side `subscribed` ref still says `true` because the browser
// PushSubscription object is "valid" from its perspective, and `enable()`
// short-circuits without re-subscribing. End result: notifications stop
// arriving and the user can only fix it by uninstalling+reinstalling the
// PWA. With this handler the browser tells us when its old endpoint died,
// we re-subscribe with the same VAPID key, and POST the new endpoint to
// the server so the next push lands.
// ---------------------------------------------------------------------------

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - base64.length % 4) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

self.addEventListener('pushsubscriptionchange', (event: Event) => {
  // Cast: 'pushsubscriptionchange' isn't in lib.webworker.d.ts's strict
  // event map yet for all TS targets. The shape is well-defined in the
  // Push API spec and stable across browsers.
  const e = event as ExtendableEvent
  e.waitUntil((async () => {
    try {
      const res = await fetch('/api/push/vapid', { credentials: 'include' })
      if (!res.ok) return
      const { vapidPublicKey } = await res.json() as { vapidPublicKey?: string }
      if (!vapidPublicKey) return

      const keyBytes = urlBase64ToUint8Array(vapidPublicKey)
      const keyBuffer = new ArrayBuffer(keyBytes.byteLength)
      new Uint8Array(keyBuffer).set(keyBytes)
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBuffer,
      })
      const json = sub.toJSON() as { endpoint: string, keys: { p256dh: string, auth: string } }
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
    }
    catch {
      // Best-effort. The browser will fire pushsubscriptionchange again
      // if our re-subscribe also fails, and the page-side heartbeat will
      // catch any drift the next time the user opens the app.
    }
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
