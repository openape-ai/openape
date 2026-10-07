<script setup lang="ts">
import { ref, watch } from 'vue'
import InboxShell from '../../../components/InboxShell.vue'

interface Item { id: string, kind: 'decision' | 'message', title: string, body: string, choices: string[], outcome: string | null, created: number, decided: number | null }

const route = useRoute()
const shell = ref<InstanceType<typeof InboxShell>>()
const item = ref<Item>()
const error = ref('')
const busy = ref(false)
const time = (at: number | null) => at ? new Date(at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'medium' }) : '—'

async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (response.status === 401) { shell.value?.expired(); return }
  const result = await response.json() as { item?: Item, code?: string }
  if (!response.ok || !result.item) { error.value = result.code === 'not_found' ? 'Dieser Eintrag existiert nicht (mehr).' : `Fehler: ${result.code ?? response.status}`; return }
  item.value = result.item
}

async function load() {
  error.value = ''
  const push = typeof route.query.push === 'string' ? `?push=${encodeURIComponent(route.query.push)}` : ''
  await request(`/inbox/api/items/${encodeURIComponent(String(route.params.id))}${push}`)
}

async function decide(choice: string) {
  if (busy.value || !item.value) return
  busy.value = true
  try { await request(`/inbox/api/items/${item.value.id}/decide`, { choice }) }
  catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}

// A push tap can switch items while this page stays mounted.
watch(() => route.fullPath, () => { item.value = undefined; load().catch((cause) => { error.value = String(cause) }) })
</script>

<template>
  <InboxShell ref="shell" @ready="load">
    <NuxtLink :to="item?.kind === 'message' ? '/inbox/?tab=messages' : '/inbox/'" class="back">
      ‹ Zurück
    </NuxtLink>
    <p v-if="error" class="inbox-error" role="alert">
      {{ error }}
    </p>
    <article v-if="item" class="inbox-card">
      <small>{{ item.kind === 'decision' ? 'Entscheidung' : 'Mitteilung' }} · {{ time(item.created) }}</small>
      <h1>{{ item.title }}</h1>
      <p>{{ item.body }}</p>
      <template v-if="item.kind === 'decision'">
        <p v-if="item.outcome" role="status">
          <strong>Entschieden: {{ item.outcome }}</strong> · {{ time(item.decided) }}
        </p>
        <div v-else class="choices">
          <button v-for="choice in item.choices" :key="choice" type="button" :disabled="busy" @click="decide(choice)">
            {{ choice }}
          </button>
        </div>
      </template>
      <small>ID {{ item.id }}</small>
    </article>
  </InboxShell>
</template>

<style scoped>
.back { display: inline-block; padding: 10px 0; color: var(--accent); text-decoration: none; min-height: 44px; box-sizing: border-box; }
h1 { font-size: 1.4em; margin: 6px 0; }
.choices { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.choices button { flex: 1; }
</style>
