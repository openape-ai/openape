<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useInbox } from '../inbox/client'
import { formatTime, language, t } from '../inbox/i18n'

const inbox = useInbox()
const { state } = inbox
const route = useRoute()
const router = useRouter()
const email = ref('')
const busy = ref(false)
const loginError = ref(route.query.login === 'failed' ? t('signInFailed') : '')
const update = ref<ServiceWorker | null>(null)
const updating = ref(false)
let registration: ServiceWorkerRegistration | undefined
let timer: ReturnType<typeof setInterval> | undefined

useHead({
  title: () => t('appName'),
  htmlAttrs: { lang: language },
  link: [{ rel: 'manifest', href: '/inbox/manifest.webmanifest' }, { rel: 'apple-touch-icon', href: '/inbox/icon-180.png' }],
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#1c4534' },
    { name: 'apple-mobile-web-app-title', content: 'Pods' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
  ],
})

const viewedKind = computed(() => route.path.startsWith('/inbox/item/') ? state.items[String(route.params.id)]?.kind : undefined)
const tabs = computed(() => [
  { to: '/inbox/', label: t('tabDecisions'), count: inbox.openDecisions.value.length, countLabel: t('countOpen', { count: inbox.openDecisions.value.length }), active: route.path === '/inbox/' || viewedKind.value === 'decision' },
  { to: '/inbox/messages', label: t('tabMessages'), count: inbox.unread.value, countLabel: t('countUnread', { count: inbox.unread.value }), active: route.path.startsWith('/inbox/messages') || viewedKind.value === 'message' },
  { to: '/inbox/settings', label: t('tabSettings'), count: 0, countLabel: '', active: route.path.startsWith('/inbox/settings') },
])
const status = computed(() => {
  if (state.syncing) return t('refreshing')
  if (state.syncError) return t('syncFailed', { error: state.syncError })
  return state.syncedAt ? t('syncedAt', { time: formatTime(state.syncedAt) }) : ''
})

async function login() {
  if (busy.value) return
  busy.value = true; loginError.value = ''
  try { await inbox.login(email.value) }
  catch (cause) { loginError.value = cause instanceof Error ? cause.message : String(cause); busy.value = false }
}

// The new worker activates only on request, and only after the owner's pending decisions were reconciled.
async function applyUpdate() {
  if (!update.value || inbox.deciding.value || updating.value) return
  updating.value = true
  await inbox.sync()
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  update.value.postMessage({ type: 'activate-update' })
}
function watchWorker(worker: ServiceWorker | null) {
  if (!worker) return
  const ready = () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) update.value = worker }
  ready()
  worker.addEventListener('statechange', ready)
}

// Foreground return is the sync point; push delivery is never relied on for correctness.
async function foreground() {
  if (document.visibilityState !== 'visible') return
  await Promise.all([state.phase === 'signedOut' ? null : inbox.sync(), registration?.update().catch(() => null)])
}
async function refresh() { await (state.phase === 'error' ? inbox.start() : inbox.sync()) }
async function tick() { if (document.visibilityState === 'visible' && state.phase === 'ready') await inbox.sync() }

async function navigate(event: MessageEvent) {
  const data = event.data as { type?: string, url?: string } | null
  if (data?.type !== 'navigate' || !data.url) return
  const target = new URL(data.url, window.location.origin)
  if (target.origin === window.location.origin && target.pathname.startsWith('/inbox/')) await router.push(target.pathname + target.search)
}

onMounted(async () => {
  // The service worker scope is /inbox/; the bare path would stay outside it.
  if (window.location.pathname === '/inbox') { window.location.replace('/inbox/'); return }
  document.addEventListener('visibilitychange', foreground)
  window.addEventListener('online', refresh)
  timer = setInterval(tick, 30000)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', navigate)
    // Without a worker the inbox still works online; only offline reading and updates are unavailable.
    registration = await navigator.serviceWorker.register('/inbox/sw.js', { scope: '/inbox/', updateViaCache: 'none' }).catch(() => undefined)
    watchWorker(registration?.waiting ?? null)
    registration?.addEventListener('updatefound', () => watchWorker(registration!.installing))
  }
  if (state.phase === 'loading') await inbox.start()
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', foreground)
  window.removeEventListener('online', refresh)
  clearInterval(timer)
  if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', navigate)
})
</script>

<template>
  <div class="inbox">
    <form v-if="state.phase === 'signedOut'" class="inbox-login" :aria-busy="busy" @submit.prevent="login">
      <img src="/inbox/icon-180.png" alt="" width="72" height="72">
      <h1>{{ t('signInTitle') }}</h1>
      <p v-if="state.signedOutReason === 'revoked'" class="inbox-note" role="status">
        {{ t('signInRevoked') }}
      </p>
      <p>{{ t('signInLead') }}</p>
      <label for="inbox-email">{{ t('signInEmail') }}</label>
      <input id="inbox-email" v-model="email" type="email" autocomplete="email" required :disabled="busy">
      <button type="submit" :disabled="busy">
        {{ busy ? t('signInBusy') : t('signInSubmit') }}
      </button>
      <p v-if="loginError" class="inbox-error" role="alert">
        {{ loginError }}
      </p>
      <p class="inbox-muted">
        {{ t('signInInstall') }}
      </p>
    </form>

    <p v-else-if="state.phase === 'loading'" class="inbox-muted" role="status">
      {{ t('loading') }}
    </p>

    <div v-else-if="state.phase === 'error'" class="inbox-banner warn" role="alert">
      <span>{{ t('unreachable', { status: state.error ?? '' }) }}</span>
      <button type="button" class="secondary" @click="refresh">
        {{ t('refresh') }}
      </button>
    </div>

    <template v-else>
      <div v-if="update" class="inbox-banner" role="status">
        <span>{{ inbox.deciding.value ? t('updateWait') : t('update') }}</span>
        <button v-if="!inbox.deciding.value" type="button" class="secondary" :disabled="updating" @click="applyUpdate">
          {{ t('updateApply') }}
        </button>
      </div>
      <div v-if="state.phase === 'offline'" class="inbox-banner warn" role="status">
        <span>{{ state.account ? t('offline', { time: formatTime(state.syncedAt) }) : t('offlineNever') }}</span>
        <small v-if="state.account">{{ t('offlineAccount', { account: state.account }) }}</small>
      </div>
      <div class="inbox-status">
        <small aria-live="polite">{{ status }}</small>
        <button type="button" class="secondary small" :disabled="state.syncing" @click="refresh">
          {{ t('refresh') }}
        </button>
      </div>
      <p v-if="!state.cacheAvailable" class="inbox-muted">
        {{ t('cacheUnavailable') }}
      </p>
      <main v-if="state.account">
        <slot />
      </main>
      <nav v-if="state.account" class="inbox-tabs" :aria-label="t('tabs')">
        <NuxtLink v-for="tab in tabs" :key="tab.to" :to="tab.to" :aria-current="tab.active ? 'page' : undefined">
          <span>{{ tab.label }}</span>
          <span v-if="tab.count" class="count" aria-hidden="true">{{ tab.count }}</span>
          <span v-if="tab.count" class="visually-hidden">, {{ tab.countLabel }}</span>
        </NuxtLink>
      </nav>
    </template>
  </div>
</template>

<style>
:root { color-scheme: light dark; --bg: #f6f4ee; --card: #fff; --text: #1d2420; --muted: #5d6762; --accent: #1c4534; --line: #dcd8cc; --warn: #8a3b12; --warn-bg: #fbeee4; }
@media (prefers-color-scheme: dark) { :root { --bg: #111613; --card: #1b221e; --text: #edf0ec; --muted: #a2aca6; --accent: #8fd1ae; --line: #2e3833; --warn: #f0a37a; --warn-bg: #2b1d15; } }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.4 system-ui, sans-serif; font: -apple-system-body; -webkit-text-size-adjust: 100%; }
.inbox { min-height: 100dvh; box-sizing: border-box; padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) calc(84px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); max-width: 640px; margin: 0 auto; overflow-wrap: anywhere; }
.inbox h1 { font-size: 1.5em; margin: 8px 0 4px; }
.inbox h2 { font-size: 1.05em; margin: 20px 0 6px; color: var(--muted); }
.inbox button, .inbox input, .inbox textarea, .inbox select { font: inherit; min-height: 44px; border-radius: 10px; box-sizing: border-box; }
.inbox button { overflow-wrap: normal; hyphens: auto; border: 1px solid var(--accent); background: var(--accent); color: var(--bg); padding: 0 16px; cursor: pointer; }
.inbox button.secondary { background: transparent; color: var(--accent); }
.inbox button.small { padding: 0 12px; }
.inbox button:disabled { opacity: .5; cursor: default; }
.inbox input, .inbox textarea, .inbox select { border: 1px solid var(--line); padding: 8px 12px; background: var(--card); color: var(--text); width: 100%; }
.inbox a { color: var(--accent); }
.inbox :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.inbox-login { display: grid; gap: 12px; margin-top: 12vh; text-align: center; }
.inbox-login img { justify-self: center; border-radius: 16px; }
.inbox-login h1 { margin: 0; }
.inbox-login label { text-align: left; color: var(--muted); }
.inbox-error { color: var(--warn); }
.inbox-muted { color: var(--muted); }
.inbox-note { background: var(--warn-bg); border-radius: 10px; padding: 10px 12px; }
.inbox-done { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.inbox-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin: 4px 0 8px; }
.inbox-banner.warn { background: var(--warn-bg); border-color: var(--warn); }
.inbox-banner small { flex-basis: 100%; color: var(--muted); }
.inbox-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); min-height: 44px; }
.inbox-card { display: block; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin: 8px 0; color: inherit; text-decoration: none; }
.inbox-card strong { display: block; }
.inbox-card small { color: var(--muted); }
.inbox-tabs { position: fixed; left: 0; right: 0; bottom: 0; display: flex; background: var(--card); border-top: 1px solid var(--line); padding: 4px max(8px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); z-index: 2; }
.inbox-tabs a { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px 6px; min-height: 52px; padding: 4px; color: var(--muted); text-decoration: none; text-align: center; border-radius: 10px; font-size: .8em; overflow-wrap: normal; hyphens: auto; }
.inbox-tabs a[aria-current] { color: var(--accent); font-weight: 600; background: var(--bg); }
.inbox-tabs .count { min-width: 1.4em; padding: 0 .35em; border-radius: 1em; background: var(--accent); color: var(--bg); font-size: .8em; font-weight: 700; line-height: 1.4em; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.inbox-body { white-space: pre-wrap; }
</style>
