<script setup lang="ts">
import { apiFetch } from '../utils/api'
import { problemMessage } from '../utils/problem-message'

interface Task {
  id: string
  deal_id: string
  title: string
  description: string | null
  due_at: string | null
  assignee_email: string
  status: string
}

const { user, fetchUser } = useOpenApeAuth()
const { activeId, load: loadWorkspaces } = useWorkspaces()
const { run } = useApiAction()
const loading = ref(true)
const loadError = ref('')
const filter = ref<'offen' | 'alle'>('offen')
const tasks = ref<Task[]>([])
const selected = ref<Task | null>(null)

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
    loadError.value = problemMessage(error, 'Aufgaben konnten nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch([activeId, filter], () => void reload())

async function reload() {
  if (!activeId.value) {
    tasks.value = []
    return
  }
  const q = filter.value === 'offen' ? '&status=offen' : ''
  tasks.value = await apiFetch(`/api/tasks?workspace_id=${activeId.value}${q}`)
  if (selected.value) selected.value = tasks.value.find(t => t.id === selected.value?.id) ?? tasks.value[0] ?? null
}

async function toggle(task: Task) {
  await run(
    () => apiFetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      body: { status: task.status === 'offen' ? 'erledigt' : 'offen' },
    }),
    { failure: 'Aufgabe konnte nicht geändert werden' },
  )
  await reload()
}
</script>

<template>
  <div class="flex h-full">
    <div class="flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-r border-[var(--crm-line)] bg-[var(--crm-panel)]">
      <header class="border-b border-[var(--crm-line)] px-3.5 py-3">
        <h2 class="mb-2.5 text-[13px] font-semibold">
          Aufgaben
        </h2>
        <div class="flex rounded-[7px] border border-[var(--crm-line)] bg-[#0b0d12] p-0.5">
          <button type="button" class="flex-1 rounded-[5px] py-1 text-xs" :class="filter === 'offen' ? 'bg-[var(--crm-panel-2)]' : 'text-[var(--crm-ink-3)]'" @click="filter = 'offen'">
            Offen
          </button>
          <button type="button" class="flex-1 rounded-[5px] py-1 text-xs" :class="filter === 'alle' ? 'bg-[var(--crm-panel-2)]' : 'text-[var(--crm-ink-3)]'" @click="filter = 'alle'">
            Alle
          </button>
        </div>
      </header>
      <div class="flex-1 overflow-auto p-1.5">
        <p v-if="loading" class="p-3 text-[var(--crm-ink-3)]">
          Lade …
        </p>
        <button
          v-for="task in tasks"
          :key="task.id"
          type="button"
          class="mb-0.5 w-full rounded-[7px] px-2.5 py-2 text-start"
          :class="selected?.id === task.id ? 'bg-[var(--crm-accent-soft)]' : 'hover:bg-[var(--crm-panel-2)]'"
          @click="selected = task"
        >
          <b class="block font-medium">{{ task.title }}</b>
          <div class="text-[11.5px] text-[var(--crm-ink-3)]">
            {{ task.due_at || 'ohne Frist' }} · {{ task.assignee_email }}
          </div>
        </button>
        <p v-if="!loading && !tasks.length" class="p-3.5 text-[var(--crm-ink-3)]">
          Keine Aufgaben.
        </p>
      </div>
    </div>
    <div v-if="selected" class="flex-1 overflow-auto p-6">
      <h1 class="text-lg font-semibold">
        {{ selected.title }}
      </h1>
      <p class="mt-2 text-sm text-[var(--crm-ink-3)]">
        {{ selected.description || 'Keine Beschreibung' }}
      </p>
      <UButton class="mt-4" @click="toggle(selected)">
        {{ selected.status === 'offen' ? 'Erledigen' : 'Wieder öffnen' }}
      </UButton>
    </div>
    <div v-else class="flex flex-1 items-center justify-center text-[var(--crm-ink-3)]">
      Keine Aufgabe ausgewählt.
    </div>
  </div>
</template>
