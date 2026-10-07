// Pods Inbox M0 prototype service worker: shows pushes, records receipts, opens the exact item.
// No fetch handler: nothing private is cached.
const version = 'm0-1'

globalThis.addEventListener('install', () => globalThis.skipWaiting())
globalThis.addEventListener('activate', event => event.waitUntil(globalThis.clients.claim()))

function receipt(token, phase) {
  if (!token) return Promise.resolve()
  return fetch('/inbox/api/receipt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, phase }) }).catch(() => {})
}

globalThis.addEventListener('push', (event) => {
  let message = {}
  try { message = event.data ? event.data.json() : {} }
  catch { message = {} }
  const notification = message.notification || {}
  const data = notification.data || {}
  const url = notification.navigate || data.url || '/inbox/'
  // iOS revokes push permission when a push shows nothing, so always display, also while the app is open.
  event.waitUntil(globalThis.registration.showNotification(notification.title || 'Pods', {
    body: notification.body || 'Neuer Eintrag.', tag: notification.tag, icon: '/inbox/icon-192.png', data: { url, receipt: data.receipt, version },
  }).then(() => receipt(data.receipt, 'shown')))
})

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { url = '/inbox/', receipt: token } = event.notification.data || {}
  event.waitUntil((async () => {
    await receipt(token, 'clicked')
    const windows = await globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find(client => new URL(client.url).pathname.startsWith('/inbox'))
    if (open) {
      await open.focus()
      open.postMessage({ type: 'navigate', url })
      return
    }
    await globalThis.clients.openWindow(url)
  })())
})
