// Troop-Chat service worker — Web-Push receiver.
globalThis.addEventListener('install', () => globalThis.skipWaiting())
globalThis.addEventListener('activate', event => event.waitUntil(globalThis.clients.claim()))

globalThis.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} }
  catch { data = {} }
  const title = data.title || 'Troop-Chat'
  const body = data.body || ''
  const url = data.url || '/chat'
  event.waitUntil((async () => {
    // If a Troop-Chat tab is open AND focused, the user already sees the answer.
    const wins = await globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (wins.some(c => c.focused || c.visibilityState === 'visible')) return
    await globalThis.registration.showNotification(title, {
      body,
      icon: '/cockpit-icon-192.png',
      badge: '/cockpit-icon-192.png',
      data: { url },
      tag: 'troop-chat',
      renotify: true,
    })
  })())
})

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/chat'
  event.waitUntil((async () => {
    const wins = await globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of wins) {
      if (c.url.includes('/chat')) { await c.focus(); return }
    }
    await globalThis.clients.openWindow(url)
  })())
})
