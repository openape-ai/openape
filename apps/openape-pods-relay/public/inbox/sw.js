// Pods Inbox service worker (plan issue 1446, M4).
// Caches only the public app shell and versioned static assets; private API responses never enter a cache.
// A new version waits until the page asks it to take over, so an update never reloads during a decision.
const version = 'badge-1'
const cacheName = `pods-inbox-${version}`
const shell = '/inbox/'
const precache = [shell, '/inbox/manifest.webmanifest', '/inbox/icon-180.png', '/inbox/icon-192.png', '/inbox/icon-512.png']

globalThis.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(precache))))
globalThis.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) {
    if (name.startsWith('pods-inbox-') && name !== cacheName) await caches.delete(name)
  }
  await globalThis.clients.claim()
})()))
globalThis.addEventListener('message', (event) => {
  if (event.data?.type === 'activate-update') globalThis.skipWaiting()
})

function cacheable(response) {
  return response.ok && response.type === 'basic' && !response.headers.get('cache-control')?.includes('no-store')
}

// The shell is the same public SPA document for every inbox page: network first, the cached copy only offline.
async function navigation(request) {
  try {
    const response = await fetch(request)
    if (cacheable(response) && response.headers.get('content-type')?.includes('text/html')) await (await caches.open(cacheName)).put(shell, response.clone())
    return response
  }
  catch (error) {
    const cached = await caches.match(shell)
    if (cached) return cached
    throw error
  }
}

// Build assets and per-build metadata carry a hash or build ID in their path, so a cached copy is always the right one.
async function asset(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (!cacheable(response)) return response
  const cache = await caches.open(cacheName)
  await cache.put(request, response.clone())
  // Every relay deployment adds new hashed files; keep the newest ones, oldest first out (keys keep insertion order).
  const keys = await cache.keys()
  for (const old of keys.filter(key => !precache.includes(new URL(key.url).pathname)).slice(0, -300)) await cache.delete(old)
  return response
}

globalThis.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== globalThis.location.origin) return
  if (event.request.mode === 'navigate' && url.pathname.startsWith('/inbox/')) event.respondWith(navigation(event.request))
  else if (url.pathname.startsWith('/pods-assets/') && url.pathname !== '/pods-assets/builds/latest.json') event.respondWith(asset(event.request))
  else if (precache.includes(url.pathname) && url.pathname !== shell) event.respondWith(caches.match(url.pathname).then(cached => cached ?? fetch(event.request)))
})

async function refreshBadge() {
  if (typeof navigator.setAppBadge !== 'function') return
  try {
    const response = await fetch('/inbox/api/v1/badge', { credentials: 'same-origin', cache: 'no-store' })
    if (response.status === 401) { await navigator.clearAppBadge(); return }
    if (!response.ok) throw new Error(`Badge request failed: ${response.status}`)
    const { count } = await response.json()
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid inbox badge count')
    if (count === 0) await navigator.clearAppBadge()
    else await navigator.setAppBadge(count)
  }
  catch (error) { console.error('Inbox badge refresh failed', error) }
}

// iOS revokes push permission when a push shows nothing, so every push displays a notification (M5 adds item routing).
globalThis.addEventListener('push', (event) => {
  let message = {}
  try { message = event.data ? event.data.json() : {} }
  catch { message = {} }
  const notification = message.notification || {}
  const url = notification.navigate || notification.data?.url || shell
  event.waitUntil(Promise.all([
    globalThis.registration.showNotification(notification.title || 'Pods', { body: notification.body || '', tag: notification.tag, icon: '/inbox/icon-192.png', data: { url } }),
    refreshBadge(),
  ]))
})

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || shell, globalThis.location.origin)
  const url = target.origin === globalThis.location.origin && target.pathname.startsWith('/inbox/') ? target.href : shell
  // Navigate first: WebKit allows focus/openWindow only briefly after the tap.
  event.waitUntil((async () => {
    const windows = await globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find(client => new URL(client.url).pathname.startsWith('/inbox'))
    if (!open) return globalThis.clients.openWindow(url)
    const focused = await open.focus()
    return focused.navigate(url).catch(() => focused.postMessage({ type: 'navigate', url }))
  })())
})
