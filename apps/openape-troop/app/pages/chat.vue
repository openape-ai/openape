<script setup lang="ts">
definePageMeta({ layout: false })
useHead({
  title: 'Troop-Chat',
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: 'Troop-Chat' },
    { name: 'theme-color', content: '#0b0b0f' },
  ],
  link: [
    { rel: 'manifest', href: '/cockpit.webmanifest' },
    { rel: 'apple-touch-icon', href: '/cockpit-icon-180.png' },
  ],
})

// Web-Push: register the SW, and let the owner opt in so an Operator answer notifies
// them even when the tab/PWA is in the background.
const showEnable = ref(false)
const busy = ref(false)

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function subscribe(reg: ServiceWorkerRegistration) {
  const key = useRuntimeConfig().public.vapidPublicKey as string
  if (!key) return
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  await $fetch('/api/push/subscribe', { method: 'POST', body: sub.toJSON() })
}

async function enable() {
  busy.value = true
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return
    await subscribe(await navigator.serviceWorker.ready)
    showEnable.value = false
  }
  finally {
    busy.value = false
  }
}

onMounted(async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    if (Notification.permission === 'granted') await subscribe(reg)
    else if (Notification.permission === 'default') showEnable.value = true
  }
  catch { /* push unsupported / blocked — the chat still works without it */ }
})
</script>

<template>
  <CockpitChat />
  <button v-if="showEnable" class="push-enable" :disabled="busy" @click="enable">
    🔔 Benachrichtigungen aktivieren
  </button>
</template>

<style>
@import '~/assets/css/cockpit.css';
.push-enable {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 8px);
  right: 10px;
  z-index: 50;
  padding: 6px 12px;
  font-size: 13px;
  line-height: 1;
  border-radius: 999px;
  background: #1b1b22;
  color: #e8e8ef;
  border: 1px solid #33333f;
  cursor: pointer;
}
.push-enable:disabled { opacity: 0.5; cursor: default; }
</style>
