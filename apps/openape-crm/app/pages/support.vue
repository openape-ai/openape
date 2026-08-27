<script setup lang="ts">
import { apiFetch } from '../utils/api'
import { problemMessage } from '../utils/problem-message'

interface LiveMail {
  id: string
  subject: string
  preview: string
  from: string
  from_name: string | null
  received_at: string | null
  matched_contact_id: string | null
  thread_id: string | null
  deal_id: string | null
}

interface MailDetail {
  id: string
  subject: string
  from: string
  from_name: string | null
  to: string[]
  received_at: string | null
  body: string
}

interface DealOpt { id: string, title: string }
interface ContactOpt { id: string, name: string, email: string | null }

const { user, fetchUser } = useOpenApeAuth()
const { activeId, load: loadWorkspaces } = useWorkspaces()
const { status: graphStatus, reload: reloadGraph, connect } = useGraph()
const { run } = useApiAction()
const loading = ref(true)
const loadError = ref('')
const mails = ref<LiveMail[]>([])
const selectedId = ref<string | null>(null)
const detail = ref<MailDetail | null>(null)
const deals = ref<DealOpt[]>([])
const contacts = ref<ContactOpt[]>([])
const attachDeal = ref('')
const attachContact = ref('')

const selected = computed(() => mails.value.find(m => m.id === selectedId.value) ?? null)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  try {
    await loadWorkspaces()
    await reloadGraph()
    await reload()
  }
  catch (error) {
    loadError.value = problemMessage(error, 'Inbox konnte nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch(activeId, () => void reload())
watch(() => graphStatus.value.connected, (ok) => {
  if (ok) void reload()
})

async function reload() {
  if (!graphStatus.value.connected) {
    mails.value = []
    return
  }
  mails.value = await apiFetch('/api/graph/inbox')
  if (activeId.value) {
    const [d, c] = await Promise.all([
      apiFetch<DealOpt[]>(`/api/deals?workspace_id=${activeId.value}`),
      apiFetch<ContactOpt[]>(`/api/contacts?workspace_id=${activeId.value}`),
    ])
    deals.value = d
    contacts.value = c
  }
  if (selectedId.value && !mails.value.some(m => m.id === selectedId.value)) {
    selectedId.value = null
    detail.value = null
  }
}

async function openMail(id: string) {
  selectedId.value = id
  const row = mails.value.find(m => m.id === id)
  attachDeal.value = row?.deal_id || ''
  attachContact.value = row?.matched_contact_id || ''
  detail.value = await apiFetch(`/api/graph/inbox/${encodeURIComponent(id)}`)
}

function closeMail() {
  selectedId.value = null
  detail.value = null
}

async function attach() {
  if (!activeId.value || !selectedId.value) return
  const created = await run(
    () => apiFetch('/api/graph/attach', {
      method: 'POST',
      body: {
        workspace_id: activeId.value,
        message_id: selectedId.value,
        deal_id: attachDeal.value || null,
        contact_id: attachContact.value || null,
      },
    }),
    { success: 'Mail angehängt', failure: 'Anhängen fehlgeschlagen' },
  )
  if (created) await reload()
}

const dealItems = computed(() => [
  { label: 'Kein Vorgang', value: '' },
  ...deals.value.map(d => ({ label: d.title, value: d.id })),
])
const contactItems = computed(() => [
  { label: 'Kein Kontakt', value: '' },
  ...contacts.value.map(c => ({ label: c.email ? `${c.name} · ${c.email}` : c.name, value: c.id })),
])
</script>

<template>
  <div class="flex h-full">
    <div
      class="h-full w-full shrink-0 flex-col overflow-hidden border-r border-[var(--crm-line)] bg-[var(--crm-panel)] md:w-[340px]"
      :class="detail ? 'hidden md:flex' : 'flex'"
    >
      <header class="border-b border-[var(--crm-line)] px-3.5 py-3">
        <h2 class="text-[13px] font-semibold">
          Inbox
        </h2>
        <p class="mt-1 text-[11.5px] text-[var(--crm-ink-3)]">
          Live aus Microsoft · letzte 50
        </p>
      </header>
      <div class="flex-1 overflow-auto p-1.5">
        <p v-if="loadError" class="p-3 text-sm text-[var(--crm-rose)]">
          {{ loadError }}
        </p>
        <p v-else-if="!graphStatus.connected" class="p-3 text-sm text-[var(--crm-ink-3)]">
          Microsoft verbinden, um die Inbox zu laden.
          <UButton size="xs" class="mt-2" @click="connect">
            Verbinden
          </UButton>
        </p>
        <button
          v-for="m in mails"
          :key="m.id"
          type="button"
          class="mb-0.5 w-full rounded-[7px] px-2.5 py-2 text-left"
          :class="selectedId === m.id ? 'bg-[var(--crm-accent-soft)]' : 'hover:bg-[var(--crm-panel-2)]'"
          @click="openMail(m.id)"
        >
          <b class="block truncate font-medium">{{ m.subject }}</b>
          <div class="truncate text-[11.5px] text-[var(--crm-ink-3)]">
            {{ m.from_name || m.from }}
            <span v-if="m.deal_id || m.thread_id"> · angehängt</span>
            <span v-else-if="m.matched_contact_id"> · Kontakt</span>
          </div>
          <div class="truncate text-[11px] text-[var(--crm-ink-3)]">
            {{ m.preview }}
          </div>
        </button>
        <p v-if="!loading && graphStatus.connected && !mails.length" class="p-3.5 text-[var(--crm-ink-3)]">
          Keine Mails.
        </p>
      </div>
    </div>
    <div
      class="min-w-0 flex-1 overflow-auto"
      :class="detail ? 'flex' : 'hidden md:flex'"
    >
      <div v-if="detail" class="flex h-full w-full flex-col">
        <header class="border-b border-[var(--crm-line)] px-4 py-3 sm:px-5">
          <UButton
            class="mb-2 md:hidden"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            @click="closeMail"
          >
            Inbox
          </UButton>
          <b>{{ detail.subject }}</b>
          <div class="mt-1 text-sm text-[var(--crm-ink-3)]">
            {{ detail.from_name || detail.from }}
            <span v-if="detail.received_at"> · {{ new Date(detail.received_at).toLocaleString('de-AT') }}</span>
          </div>
        </header>
        <div class="flex flex-wrap items-end gap-2 border-b border-[var(--crm-line)] px-4 py-3 sm:px-5">
          <UFormField label="Vorgang" class="min-w-0 flex-1 basis-full sm:basis-48">
            <USelect v-model="attachDeal" :items="dealItems" class="w-full" />
          </UFormField>
          <UFormField label="Kontakt" class="min-w-0 flex-1 basis-full sm:basis-48">
            <USelect v-model="attachContact" :items="contactItems" class="w-full" />
          </UFormField>
          <UButton :disabled="!attachDeal && !attachContact" @click="attach">
            Anhängen
          </UButton>
          <NuxtLink v-if="selected?.deal_id" :to="`/vorgaenge?id=${selected.deal_id}`" class="text-sm text-[var(--crm-accent-2)]">
            Zum Vorgang
          </NuxtLink>
        </div>
        <pre class="flex-1 overflow-auto px-4 py-4 whitespace-pre-wrap font-sans text-sm text-[var(--crm-ink-2)] sm:px-5">{{ detail.body }}</pre>
      </div>
      <div v-else class="flex h-full w-full items-center justify-center text-[var(--crm-ink-3)]">
        Mail öffnen.
      </div>
    </div>
  </div>
</template>
