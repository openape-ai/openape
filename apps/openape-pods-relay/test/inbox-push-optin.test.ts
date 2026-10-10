import { expect, it, vi } from 'vitest'
import type { Inbox } from '../app/inbox/client'
import { disablePush, enablePush, pushState, renewPush, serverKey } from '../app/inbox/push'

function device(permission: NotificationPermission, answer: NotificationPermission = permission, subscribed = false) {
  let current: { toJSON: () => PushSubscriptionJSON, unsubscribe: () => Promise<boolean> } | null = null
  const unsubscribe = vi.fn(async () => { current = null; return true })
  const make = () => ({ toJSON: () => ({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe })
  if (subscribed) current = make()
  const subscribe = vi.fn(async (_options: PushSubscriptionOptionsInit) => { current = make(); return current })
  const pushManager = { getSubscription: async () => current, subscribe } as unknown as PushManager
  const Notification = { permission, requestPermission: vi.fn(async () => { Notification.permission = answer; return answer }) }
  const environment = { Notification, serviceWorker: { ready: Promise.resolve({ pushManager }), getRegistration: async () => ({ pushManager }) } }
  const inbox = { pushSubscribe: vi.fn(async () => ({})), pushUnsubscribe: vi.fn(async () => ({})) } as unknown as Inbox & { pushSubscribe: ReturnType<typeof vi.fn>, pushUnsubscribe: ReturnType<typeof vi.fn> }
  return { environment, inbox, subscribe, unsubscribe, Notification }
}

it('subscribes with the server key after the owner allows notifications and reports the device', async () => {
  const phone = device('default', 'granted')
  expect(await pushState(phone.environment)).toBe('off')
  expect(await enablePush(phone.inbox, 'AQID', phone.environment)).toBe('on')
  expect(phone.Notification.requestPermission).toHaveBeenCalledOnce()
  expect(phone.subscribe.mock.calls[0]![0]).toEqual({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) })
  expect(phone.inbox.pushSubscribe).toHaveBeenCalledWith({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'p', auth: 'a' } })
  expect(await pushState(phone.environment)).toBe('on')
})

it('stays off without subscribing when the owner declines, and reports unsupported browsers', async () => {
  const declined = device('default', 'denied')
  expect(await enablePush(declined.inbox, 'AQID', declined.environment)).toBe('denied')
  expect(declined.subscribe).not.toHaveBeenCalled()
  expect(declined.inbox.pushSubscribe).not.toHaveBeenCalled()
  expect(await pushState({})).toBe('unavailable')
})

it('unsubscribes locally and on the service, and renews an existing subscription on start', async () => {
  const phone = device('granted', 'granted', true)
  await renewPush(phone.inbox, phone.environment)
  expect(phone.inbox.pushSubscribe).toHaveBeenCalledOnce()
  expect(await disablePush(phone.inbox, phone.environment)).toBe('off')
  expect(phone.unsubscribe).toHaveBeenCalledOnce()
  expect(phone.inbox.pushUnsubscribe).toHaveBeenCalledOnce()
  const notAsked = device('default')
  await renewPush(notAsked.inbox, notAsked.environment)
  expect(notAsked.inbox.pushSubscribe).not.toHaveBeenCalled()
})

it('decodes the base64url VAPID key', () => {
  expect([...serverKey('-_8')]).toEqual([251, 255])
})
