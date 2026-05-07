import { onMounted, ref } from 'vue'

interface PushHandle {
  supported: ReturnType<typeof ref<boolean>>
  subscribed: ReturnType<typeof ref<boolean>>
  permissionGranted: ReturnType<typeof ref<boolean>>
  /**
   * Ask the browser for notification permission and create a Push
   * subscription. Returns true on success, false otherwise (denied,
   * unsupported, or fetch failed). Safe to call multiple times — already-
   * subscribed sessions short-circuit.
   */
  enable: () => Promise<boolean>
  disable: () => Promise<void>
}

/**
 * Web-Push integration. Deliberately gated on `display-mode: standalone`
 * so we never prompt the user for the Notification permission on a normal
 * browser tab. The prompt is only shown after the app is installed (Add
 * to Home Screen on iOS, install prompt on Android/Chrome) — at that
 * point the user has explicitly opted in to "treat this like a real app",
 * and notifications make sense.
 */
export function usePushSubscription(): PushHandle {
  const supported = ref(false)
  const subscribed = ref(false)
  const permissionGranted = ref(false)

  function isStandalone(): boolean {
    if (typeof window === 'undefined') return false
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    return (window.navigator as { standalone?: boolean }).standalone === true
  }

  async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
    return await navigator.serviceWorker.ready
  }

  async function refresh() {
    if (typeof window === 'undefined') return
    if (!('Notification' in window) || !('PushManager' in window)) {
      supported.value = false
      return
    }
    if (!isStandalone()) {
      // Don't even probe state on non-installed tabs — we never want the
      // permission UI to flash there.
      supported.value = false
      return
    }
    supported.value = true
    permissionGranted.value = Notification.permission === 'granted'
    const reg = await getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    subscribed.value = !!sub

    // Heartbeat: re-POST the current subscription on every load. The
    // server-side push.ts deletes a subscription row on 404/410 from the
    // push service — but the browser-side PushSubscription is still
    // "valid" from its own perspective, so without re-POSTing we'd quietly
    // stay out of the DB and miss every subsequent notification. The POST
    // is an idempotent upsert keyed on `endpoint`, so this is cheap and
    // safe to call on every app open.
    if (sub) {
      const json = sub.toJSON() as { endpoint?: string, keys?: { p256dh: string, auth: string } }
      if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
        try {
          await $fetch('/api/push/subscribe', {
            method: 'POST',
            body: { endpoint: json.endpoint, keys: json.keys },
          })
        }
        catch {
          // Best-effort heartbeat — never block UI on it.
        }
      }
    }
  }

  function urlBase64ToUint8Array(base64: string): Uint8Array {
    const padding = '='.repeat((4 - base64.length % 4) % 4)
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(b64)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
  }

  async function enable(): Promise<boolean> {
    await refresh()
    if (!supported.value) return false
    if (subscribed.value) return true

    const perm = await Notification.requestPermission()
    permissionGranted.value = perm === 'granted'
    if (perm !== 'granted') return false

    const reg = await getRegistration()
    if (!reg) return false

    const { vapidPublicKey } = await $fetch<{ vapidPublicKey: string }>('/api/push/vapid')
    if (!vapidPublicKey) return false

    let sub: globalThis.PushSubscription
    try {
      // applicationServerKey expects a BufferSource — but the latest
      // lib.dom narrowed it to ArrayBuffer (excluding SharedArrayBuffer)
      // and Uint8Array<ArrayBuffer> via slice() returns the union. Allocate
      // a fresh ArrayBuffer with the bytes copied in to satisfy both.
      const keyBytes = urlBase64ToUint8Array(vapidPublicKey)
      const keyBuffer = new ArrayBuffer(keyBytes.byteLength)
      new Uint8Array(keyBuffer).set(keyBytes)
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBuffer,
      })
    }
    catch {
      return false
    }

    const json = sub.toJSON() as { endpoint: string, keys: { p256dh: string, auth: string } }
    try {
      await $fetch('/api/push/subscribe', {
        method: 'POST',
        body: { endpoint: json.endpoint, keys: json.keys },
      })
    }
    catch {
      // Backend rejected — drop the local subscription so the next attempt
      // doesn't think we're already enrolled.
      await sub.unsubscribe().catch(() => {})
      return false
    }
    subscribed.value = true
    return true
  }

  async function disable() {
    const reg = await getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) {
      subscribed.value = false
      return
    }
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => {})
    subscribed.value = false
    await $fetch('/api/push/subscribe', {
      method: 'DELETE',
      body: { endpoint },
    }).catch(() => { /* server is best-effort */ })
  }

  onMounted(refresh)

  return { supported, subscribed, permissionGranted, enable, disable }
}
