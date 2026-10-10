import type { Inbox } from './client'

// Web Push opt-in for this device (plan issue 1446, M5). On iOS the home-screen app asks for permission only after a
// tap, and the same permission also allows the count on the app icon.
export type PushState = 'unavailable' | 'denied' | 'off' | 'on'

interface PushEnvironment {
  Notification?: { permission: NotificationPermission, requestPermission: () => Promise<NotificationPermission> }
  serviceWorker?: { ready: Promise<{ pushManager: PushManager }>, getRegistration: (scope: string) => Promise<{ pushManager: PushManager } | undefined> }
}

function browser(): PushEnvironment {
  if (typeof window === 'undefined' || !('PushManager' in window) || typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return {}
  return { Notification, serviceWorker: navigator.serviceWorker }
}

export function serverKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

export async function pushState(environment = browser()): Promise<PushState> {
  if (!environment.Notification || !environment.serviceWorker) return 'unavailable'
  if (environment.Notification.permission === 'denied') return 'denied'
  if (environment.Notification.permission !== 'granted') return 'off'
  const registration = await environment.serviceWorker.getRegistration('/inbox/')
  return await registration?.pushManager.getSubscription() ? 'on' : 'off'
}

// Must be called directly from the owner's tap: Safari ignores a permission request without a user gesture.
export async function enablePush(inbox: Inbox, vapidPublicKey: string, environment = browser()): Promise<PushState> {
  if (!environment.Notification || !environment.serviceWorker || !vapidPublicKey) return 'unavailable'
  const permission = await environment.Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const { pushManager } = await environment.serviceWorker.ready
  const subscription = await pushManager.getSubscription() ?? await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey(vapidPublicKey) })
  await inbox.pushSubscribe(subscription.toJSON())
  return 'on'
}

export async function disablePush(inbox: Inbox, environment = browser()): Promise<PushState> {
  const registration = await environment.serviceWorker?.getRegistration('/inbox/')
  await (await registration?.pushManager.getSubscription())?.unsubscribe()
  await inbox.pushUnsubscribe()
  return environment.Notification ? 'off' : 'unavailable'
}

// A browser may renew the endpoint and a new sign-in starts a new device: report the current one on each start.
export async function renewPush(inbox: Inbox, environment = browser()): Promise<void> {
  if (environment.Notification?.permission !== 'granted' || !environment.serviceWorker) return
  const registration = await environment.serviceWorker.getRegistration('/inbox/')
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) await inbox.pushSubscribe(subscription.toJSON())
}
