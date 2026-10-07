<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import InboxShell from '../../components/InboxShell.vue'
import type { InboxSession } from '../../components/InboxShell.vue'

interface Item { id: string, kind: 'decision' | 'message', title: string, body: string, outcome: string | null, created: number, read: number | null }
interface Push { id: string, itemId: string | null, scheduled: number, sent: number | null, status: number | null, error: string | null, shown: number | null, clicked: number | null, opened: number | null }

const route = useRoute()
const shell = ref<InstanceType<typeof InboxShell>>()
const tab = computed(() => route.query.tab === 'messages' || route.query.tab === 'device' ? route.query.tab : 'decisions')
const items = ref<Item[]>([])
const pushes = ref<Push[]>([])
const session = ref<InboxSession>()
const status = ref('')
const permission = ref(typeof Notification === 'undefined' ? 'nicht verfügbar' : Notification.permission)
const standalone = ref(import.meta.client && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true))
const decisions = computed(() => items.value.filter(item => item.kind === 'decision'))
const messages = computed(() => items.value.filter(item => item.kind === 'message'))
const pending = computed(() => decisions.value.filter(item => !item.outcome).length)
const unread = computed(() => messages.value.filter(item => !item.read).length)
const time = (at: number | null) => at ? new Date(at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'medium' }) : '—'
const delay = (from: number | null, to: number | null) => from && to ? `${Math.round((to - from) / 1000)} s` : '—'

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/inbox/api/${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (response.status === 401) { shell.value?.expired(); throw new Error('Sitzung abgelaufen') }
  const result = await response.json() as T & { code?: string }
  if (!response.ok) throw new Error(result.code ?? `HTTP ${response.status}`)
  return result
}

async function refresh() {
  const [list, log] = await Promise.all([api<{ items: Item[] }>('items'), api<{ pushes: Push[] }>('pushes')])
  items.value = list.items; pushes.value = log.pushes
}

async function ready(value: InboxSession) { session.value = value; await refresh() }

function key(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob((base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, character => character.charCodeAt(0))
}

async function enablePush() {
  status.value = ''
  const current = session.value
  if (!current) return
  try {
    if (!('PushManager' in window)) throw new Error('Push ist nur in der installierten App verfügbar (Teilen → Zum Home-Bildschirm).')
    permission.value = await Notification.requestPermission()
    if (permission.value !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt.')
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(current.vapidPublicKey) })
    const result = await api<{ devices: number }>('subscribe', { subscription: subscription.toJSON() })
    current.devices = result.devices
    status.value = 'Mitteilungen aktiv.'
  }
  catch (cause) { status.value = cause instanceof Error ? cause.message : String(cause) }
}

// Two days of waking-hour pushes (08–22 local), roughly every 70 minutes with jitter; 24 in total.
function series(): number[] {
  const times: number[] = []
  for (let at = Date.now() + 5 * 60000; times.length < 24 && at < Date.now() + 3 * 86400000; at += 70 * 60000) {
    const jittered = at + Math.round((Math.random() - 0.5) * 30 * 60000)
    const hour = new Date(jittered).getHours()
    if (hour >= 8 && hour < 22) times.push(jittered)
  }
  return times
}

async function schedule(times: number[]) {
  status.value = ''
  try { pushes.value = (await api<{ pushes: Push[] }>('schedule', { times })).pushes; status.value = `${times.length} Push(es) geplant.` }
  catch (cause) { status.value = cause instanceof Error ? cause.message : String(cause) }
}

async function cancel() {
  try { pushes.value = (await api<{ pushes: Push[] }>('schedule/cancel', {})).pushes; status.value = 'Offene Pushes abgebrochen.' }
  catch (cause) { status.value = cause instanceof Error ? cause.message : String(cause) }
}

async function logout() {
  await fetch('/workspace-auth/logout', { method: 'POST' })
  shell.value?.expired()
}

// Foreground return is the sync point; push delivery is never relied on for correctness.
function foreground() { if (document.visibilityState === 'visible' && session.value) refresh().catch((cause) => { status.value = String(cause) }) }
onMounted(() => document.addEventListener('visibilitychange', foreground))
onUnmounted(() => document.removeEventListener('visibilitychange', foreground))
</script>

<template>
  <InboxShell ref="shell" @ready="ready">
    <nav class="tabs" aria-label="Bereiche">
      <NuxtLink :to="{ query: {} }" :aria-current="tab === 'decisions' ? 'page' : undefined">
        Entscheidungen<span v-if="pending" class="count">{{ pending }}</span>
      </NuxtLink>
      <NuxtLink :to="{ query: { tab: 'messages' } }" :aria-current="tab === 'messages' ? 'page' : undefined">
        Mitteilungen<span v-if="unread" class="count">{{ unread }}</span>
      </NuxtLink>
      <NuxtLink :to="{ query: { tab: 'device' } }" :aria-current="tab === 'device' ? 'page' : undefined" aria-label="Gerät und Test">
        ⚙︎
      </NuxtLink>
    </nav>

    <section v-if="tab === 'decisions'" aria-label="Entscheidungen">
      <p v-if="!decisions.length" class="inbox-muted">
        Keine Entscheidungen. Testpushes unter ⚙︎ planen.
      </p>
      <NuxtLink v-for="item in decisions" :key="item.id" class="inbox-card" :to="`/inbox/item/${item.id}`">
        <strong>{{ item.title }}</strong>
        <small>{{ item.outcome ? `Erledigt: ${item.outcome}` : 'Offen' }} · {{ time(item.created) }}</small>
      </NuxtLink>
    </section>

    <section v-else-if="tab === 'messages'" aria-label="Mitteilungen">
      <p v-if="!messages.length" class="inbox-muted">
        Keine Mitteilungen.
      </p>
      <NuxtLink v-for="item in messages" :key="item.id" class="inbox-card" :to="`/inbox/item/${item.id}`">
        <strong>{{ item.read ? '' : '● ' }}{{ item.title }}</strong>
        <small>{{ time(item.created) }}</small>
      </NuxtLink>
    </section>

    <section v-else aria-label="Gerät und Test" class="device">
      <dl>
        <dt>Konto</dt><dd>{{ session?.subject }} · {{ session?.issuer }}</dd>
        <dt>Installiert</dt><dd>{{ standalone ? 'ja (Home-Bildschirm)' : 'nein – im Browser geöffnet' }}</dd>
        <dt>Berechtigung</dt><dd>{{ permission }}</dd>
        <dt>Registrierte Geräte</dt><dd>{{ session?.devices }}</dd>
        <dt>App-Version</dt><dd>{{ session?.version }}</dd>
      </dl>
      <div class="actions">
        <button type="button" @click="enablePush">
          Mitteilungen aktivieren
        </button>
        <button type="button" class="secondary" @click="schedule([Date.now()])">
          Test-Push jetzt
        </button>
        <button type="button" class="secondary" @click="schedule([Date.now() + 60000])">
          In 1 Minute
        </button>
        <button type="button" class="secondary" @click="schedule([Date.now() + 5 * 60000])">
          In 5 Minuten
        </button>
        <button type="button" class="secondary" @click="schedule(series())">
          Zweitagesserie (24)
        </button>
        <button type="button" class="secondary" @click="cancel">
          Offene abbrechen
        </button>
        <button type="button" class="secondary" @click="foreground">
          Aktualisieren
        </button>
        <button type="button" class="secondary" @click="logout">
          Abmelden
        </button>
      </div>
      <p v-if="status" role="status">
        {{ status }}
      </p>
      <h2>Push-Protokoll</h2>
      <div class="log">
        <table>
          <thead><tr><th>Geplant</th><th>Gesendet</th><th>HTTP</th><th>Angezeigt</th><th>Angetippt</th><th>Geöffnet</th></tr></thead>
          <tbody>
            <tr v-for="push in pushes" :key="push.id">
              <td>{{ time(push.scheduled) }}</td>
              <td>{{ push.sent ? time(push.sent) : 'ausstehend' }}</td>
              <td :title="push.error ?? ''">
                {{ push.status ?? (push.error ? 'Fehler' : '—') }}
              </td>
              <td>{{ delay(push.sent, push.shown) }}</td>
              <td>{{ delay(push.sent, push.clicked) }}</td>
              <td>{{ delay(push.sent, push.opened) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </InboxShell>
</template>

<style scoped>
.tabs { display: flex; gap: 6px; position: sticky; top: 0; background: var(--bg); padding: 6px 0 10px; z-index: 1; }
.tabs a { flex: 1; text-align: center; padding: 10px 8px; border-radius: 10px; color: var(--muted); text-decoration: none; border: 1px solid var(--line); }
.tabs a:last-child { flex: 0 0 48px; }
.tabs a[aria-current] { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.count { margin-left: 6px; font-size: .8em; font-weight: 700; }
.device dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; overflow-wrap: anywhere; }
.device dt { color: var(--muted); }
.device dd { margin: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.log { overflow-x: auto; }
.log table { border-collapse: collapse; font-size: .8em; width: 100%; }
.log th, .log td { border-bottom: 1px solid var(--line); padding: 4px 6px; text-align: left; white-space: nowrap; }
</style>
