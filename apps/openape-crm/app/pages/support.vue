<script setup lang="ts">
import { apiFetch } from '../utils/api'
import { problemMessage } from '../utils/problem-message'

interface Thread {
  id: string
  deal_id: string | null
  subject: string
  status: string
  source: string
  created_at: number
}

const { user, fetchUser } = useOpenApeAuth()
const { activeId, load: loadWorkspaces } = useWorkspaces()
const { status: graphStatus, connect } = useGraph()
const loading = ref(true)
const loadError = ref('')
const filter = ref<'alle' | 'neu'>('alle')
const threads = ref<Thread[]>([])
const selectedId = computed(() => String(useRoute().params.id || ''))

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  try {
    await loadWorkspaces()
    await reload()
  }
  catch (error) {
    loadError.value = problemMessage(error, 'Support konnte nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch(activeId, () => void reload())

async function reload() {
  if (!activeId.value) {
    threads.value = []
    return
  }
  if (graphStatus.value.connected) {
    await apiFetch(`/api/graph/inbox/pull?workspace_id=${activeId.value}`, { method: 'POST' }).catch(() => null)
  }
  const rows = await apiFetch<Thread[]>(`/api/threads?workspace_id=${activeId.value}`)
  threads.value = filter.value === 'neu' ? rows.filter(t => t.status === 'neu') : rows
}

watch(filter, () => void reload())

const visible = computed(() => threads.value)
</script>

<template>
  <div class="flex h-full">
    <div class="flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-r border-[var(--crm-line)] bg-[var(--crm-panel)]">
      <header class="border-b border-[var(--crm-line)] px-3.5 py-3">
        <h2 class="mb-2.5 text-[13px] font-semibold">
          Support
        </h2>
        <div class="flex rounded-[7px] border border-[var(--crm-line)] bg-[#0b0d12] p-0.5">
          <button type="button" class="flex-1 rounded-[5px] py-1 text-xs" :class="filter === 'alle' ? 'bg-[var(--crm-panel-2)]' : 'text-[var(--crm-ink-3)]'" @click="filter = 'alle'">
            Alle
          </button>
          <button type="button" class="flex-1 rounded-[5px] py-1 text-xs" :class="filter === 'neu' ? 'bg-[var(--crm-panel-2)]' : 'text-[var(--crm-ink-3)]'" @click="filter = 'neu'">
            Neu
          </button>
        </div>
      </header>
      <div class="flex-1 overflow-auto p-1.5">
        <p v-if="!graphStatus.connected" class="p-3 text-sm text-[var(--crm-ink-3)]">
          Microsoft verbinden, um die Inbox zu laden.
          <UButton size="xs" class="mt-2" @click="connect">
            Verbinden
          </UButton>
        </p>
        <NuxtLink
          v-for="t in visible"
          :key="t.id"
          :to="`/support/${t.id}`"
          class="mb-0.5 block rounded-[7px] px-2.5 py-2"
          :class="selectedId === t.id ? 'bg-[var(--crm-accent-soft)]' : 'hover:bg-[var(--crm-panel-2)]'"
        >
          <b class="block font-medium">{{ t.subject }}</b>
          <div class="text-[11.5px] text-[var(--crm-ink-3)]">
            {{ t.source }} · {{ t.status }}
          </div>
        </NuxtLink>
        <p v-if="!loading && !visible.length" class="p-3.5 text-[var(--crm-ink-3)]">
          Keine Threads.
        </p>
      </div>
    </div>
    <div class="min-w-0 flex-1">
      <NuxtPage />
    </div>
  </div>
</template>
