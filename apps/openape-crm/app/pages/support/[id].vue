<script setup lang="ts">
import { apiFetch } from '../../utils/api'

interface Message { id: string, from_address: string, body: string, created_at: number }
interface Thread {
  id: string
  deal_id: string | null
  subject: string
  status: string
  source: string
  messages: Message[]
}

const route = useRoute()
const router = useRouter()
const { run } = useApiAction()
const { status: graphStatus } = useGraph()
const thread = ref<Thread | null>(null)
const reply = ref('')
const to = ref('')

const statuses = [
  { label: 'Neu', value: 'neu' },
  { label: 'Warten Kunde', value: 'warten_kunde' },
  { label: 'Warten uns', value: 'warten_uns' },
  { label: 'Abgeschlossen', value: 'abgeschlossen' },
]

async function load() {
  thread.value = await apiFetch(`/api/threads/${route.params.id}`)
  to.value = thread.value?.messages[0]?.from_address || ''
}

onMounted(() => void load())
watch(() => route.params.id, () => void load())

async function setStatus(status: string) {
  await run(
    () => apiFetch(`/api/threads/${route.params.id}`, { method: 'PATCH', body: { status } }),
    { failure: 'Status konnte nicht geändert werden' },
  )
  await load()
}

async function send() {
  const sent = await run(
    () => apiFetch(`/api/threads/${route.params.id}/messages`, { method: 'POST', body: { body: reply.value, to: to.value } }),
    { success: 'Antwort gesendet', failure: 'Antwort fehlgeschlagen' },
  )
  if (sent) {
    reply.value = ''
    await load()
  }
}

async function createDeal() {
  await router.push('/vorgaenge')
}
</script>

<template>
  <div v-if="thread" class="flex h-full flex-col">
    <header class="flex items-center gap-2 border-b border-[var(--crm-line)] px-5 py-3">
      <b>{{ thread.subject }}</b>
      <span class="rounded-full border border-[var(--crm-line)] px-2 text-[11px] text-[var(--crm-ink-3)]">{{ thread.source }}</span>
      <USelect :model-value="thread.status" :items="statuses" size="xs" class="ms-auto w-40" @update:model-value="setStatus(String($event))" />
    </header>
    <div class="flex-1 overflow-auto px-5 py-4">
      <p v-if="thread.deal_id" class="mb-4 text-sm text-[var(--crm-ink-3)]">
        Zugeordnet zu einem Vorgang.
      </p>
      <p v-else class="mb-4 text-sm text-[var(--crm-ink-3)]">
        Absender keinem Vorgang zugeordnet.
        <UButton size="xs" class="ms-2" @click="createDeal">
          Vorgang anlegen
        </UButton>
      </p>
      <ul class="space-y-3">
        <li v-for="msg in thread.messages" :key="msg.id" class="rounded-lg border border-[var(--crm-line)] bg-[var(--crm-panel)] p-3">
          <div class="flex text-sm">
            <b>{{ msg.from_address }}</b>
            <span class="ms-auto text-[11.5px] text-[var(--crm-ink-3)]">{{ new Date(msg.created_at).toLocaleString('de-AT') }}</span>
          </div>
          <p class="mt-2 mb-0 whitespace-pre-wrap text-[var(--crm-ink-2)]">
            {{ msg.body }}
          </p>
        </li>
      </ul>
    </div>
    <form class="flex gap-2 border-t border-[var(--crm-line)] p-3" @submit.prevent="send">
      <UInput v-model="reply" class="flex-1" placeholder="Antwort …" :disabled="!graphStatus.connected" />
      <UButton type="submit" :disabled="!reply.trim() || !graphStatus.connected">
        Senden
      </UButton>
    </form>
  </div>
</template>
