<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

export interface InboxSession { issuer: string, subject: string, vapidPublicKey: string, devices: number, version: string }

const emit = defineEmits<{ ready: [session: InboxSession] }>()
const route = useRoute()
const router = useRouter()
const session = ref<InboxSession | null>(null)
const signedOut = ref(false)
const email = ref('')
const busy = ref(false)
const error = ref(route.query.login === 'failed' ? 'Die Anmeldung wurde nicht abgeschlossen. Bitte erneut versuchen.' : '')

useHead({
  title: 'Pods Inbox',
  link: [{ rel: 'manifest', href: '/inbox/manifest.webmanifest' }, { rel: 'apple-touch-icon', href: '/inbox/icon-180.png' }],
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#1c4534' },
    { name: 'apple-mobile-web-app-title', content: 'Pods' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
  ],
})

async function load() {
  const response = await fetch('/inbox/api/session', { cache: 'no-store' })
  if (response.status === 401) { signedOut.value = true; return }
  if (!response.ok) { error.value = `Inbox nicht erreichbar (${response.status}).`; return }
  session.value = await response.json() as InboxSession
  signedOut.value = false
  emit('ready', session.value)
}

function returnPath(): string {
  const target = new URL(route.fullPath, window.location.origin)
  target.searchParams.delete('login')
  return target.pathname + target.search
}

async function login() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const response = await fetch('/workspace-auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value.trim(), returnTo: returnPath() }), redirect: 'error' })
    const result = await response.json() as { redirectUrl?: string, statusMessage?: string, code?: string }
    if (!response.ok || !result.redirectUrl) throw new Error(result.statusMessage || result.code || 'Anmeldung konnte nicht gestartet werden.')
    window.location.assign(result.redirectUrl)
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); busy.value = false }
}

function navigate(event: MessageEvent) {
  const data = event.data as { type?: string, url?: string } | null
  if (data?.type !== 'navigate' || !data.url) return
  const target = new URL(data.url, window.location.origin)
  if (target.origin === window.location.origin && target.pathname.startsWith('/inbox')) router.push(target.pathname + target.search)
}

function expired() { session.value = null; signedOut.value = true }
defineExpose({ expired, reload: load })

onMounted(() => {
  // The service worker scope is /inbox/; the bare path would stay outside it. A server redirect rule also matches /inbox/.
  if (window.location.pathname === '/inbox') { window.location.replace('/inbox/'); return }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/inbox/sw.js', { scope: '/inbox/' }).catch((cause) => { error.value = `Service Worker: ${String(cause)}` })
    navigator.serviceWorker.addEventListener('message', navigate)
  }
  load().catch((cause) => { error.value = String(cause) })
})
onUnmounted(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', navigate) })
</script>

<template>
  <div class="inbox">
    <p v-if="error" class="inbox-error" role="alert">
      {{ error }}
    </p>
    <form v-if="signedOut" class="inbox-login" :aria-busy="busy" @submit.prevent="login">
      <img src="/inbox/icon-180.png" alt="" width="72" height="72">
      <h1>Pods Inbox</h1>
      <p>Mit deiner OpenApe-Identität anmelden.</p>
      <label for="inbox-email">E-Mail</label>
      <input id="inbox-email" v-model="email" type="email" autocomplete="email" required :disabled="busy">
      <button type="submit" :disabled="busy">
        {{ busy ? 'Verbinde …' : 'Weiter mit OpenApe' }}
      </button>
    </form>
    <slot v-else-if="session" :session="session" />
    <p v-else class="inbox-muted">
      Lädt …
    </p>
  </div>
</template>

<style>
:root { color-scheme: light dark; --bg: #f6f4ee; --card: #fff; --text: #1d2420; --muted: #5d6762; --accent: #1c4534; --line: #dcd8cc; --warn: #8a3b12; }
@media (prefers-color-scheme: dark) { :root { --bg: #111613; --card: #1b221e; --text: #edf0ec; --muted: #a2aca6; --accent: #8fd1ae; --line: #2e3833; --warn: #f0a37a; } }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.4 system-ui, sans-serif; font: -apple-system-body; -webkit-text-size-adjust: 100%; }
.inbox { min-height: 100dvh; box-sizing: border-box; padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); max-width: 640px; margin: 0 auto; }
.inbox button, .inbox input { font: inherit; min-height: 44px; border-radius: 10px; }
.inbox button { border: 1px solid var(--accent); background: var(--accent); color: var(--bg); padding: 0 16px; cursor: pointer; }
.inbox button.secondary { background: transparent; color: var(--accent); }
.inbox button:disabled { opacity: .5; }
.inbox input { border: 1px solid var(--line); padding: 0 12px; background: var(--card); color: var(--text); }
.inbox-login { display: grid; gap: 12px; margin-top: 15vh; text-align: center; }
.inbox-login img { justify-self: center; border-radius: 16px; }
.inbox-login h1 { margin: 0; }
.inbox-login label { text-align: left; color: var(--muted); }
.inbox-error { color: var(--warn); }
.inbox-muted { color: var(--muted); }
.inbox-card { display: block; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin: 8px 0; color: inherit; text-decoration: none; }
.inbox-card strong { display: block; }
.inbox-card small { color: var(--muted); }
</style>
