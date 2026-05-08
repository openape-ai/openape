<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

const route = useRoute()
const agentName = computed(() => String(route.params.name))

useSeoMeta({ title: () => `Agent ${agentName.value}` })

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

interface Agent {
  email: string
  ownerEmail: string
  agentName: string
  hostId: string | null
  hostname: string | null
  pubkeySsh: string | null
  firstSeenAt: number | null
  lastSeenAt: number | null
  createdAt: number
}
interface Task {
  agentEmail: string
  taskId: string
  name: string
  cron: string
  systemPrompt: string
  tools: string[]
  maxSteps: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}
interface Run {
  id: string
  agentEmail: string
  taskId: string
  startedAt: number
  finishedAt: number | null
  status: 'running' | 'ok' | 'error'
  finalMessage: string | null
  stepCount: number | null
  trace: unknown
}
interface Detail {
  agent: Agent
  tasks: Task[]
  recentRuns: Run[]
}

const detail = ref<Detail | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    detail.value = await ($fetch as any)(`/api/agents/${agentName.value}`)
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || 'failed to load agent'
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => { if (u) load() }, { immediate: true })
onMounted(() => { if (!user.value) navigateTo('/login') })

// Task editor state
const showEditor = ref(false)
const editing = ref<{ taskId: string, isNew: boolean }>({ taskId: '', isNew: true })
const form = ref({
  task_id: '',
  name: '',
  cron: '*/5 * * * *',
  system_prompt: '',
  tools: [] as string[],
  max_steps: 10,
  enabled: true,
})
const saving = ref(false)
const saveError = ref('')

function openCreate() {
  editing.value = { taskId: '', isNew: true }
  form.value = {
    task_id: '',
    name: '',
    cron: '*/5 * * * *',
    system_prompt: '',
    tools: [],
    max_steps: 10,
    enabled: true,
  }
  saveError.value = ''
  showEditor.value = true
}

function openEdit(t: Task) {
  editing.value = { taskId: t.taskId, isNew: false }
  form.value = {
    task_id: t.taskId,
    name: t.name,
    cron: t.cron,
    system_prompt: t.systemPrompt,
    tools: [...t.tools],
    max_steps: t.maxSteps,
    enabled: t.enabled,
  }
  saveError.value = ''
  showEditor.value = true
}

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    if (editing.value.isNew) {
      await ($fetch as any)(`/api/agents/${agentName.value}/tasks`, {
        method: 'POST',
        body: form.value,
      })
    }
    else {
      await ($fetch as any)(`/api/agents/${agentName.value}/tasks/${editing.value.taskId}`, {
        method: 'PUT',
        body: {
          name: form.value.name,
          cron: form.value.cron,
          system_prompt: form.value.system_prompt,
          tools: form.value.tools,
          max_steps: form.value.max_steps,
          enabled: form.value.enabled,
        },
      })
    }
    showEditor.value = false
    await load()
  }
  catch (err: any) {
    saveError.value = err?.data?.statusMessage || err?.message || 'save failed'
  }
  finally {
    saving.value = false
  }
}

async function remove(t: Task) {
  if (!confirm(`Delete task "${t.name}"? Active launchd jobs on the agent host will be removed on the next sync.`)) return
  try {
    await ($fetch as any)(`/api/agents/${agentName.value}/tasks/${t.taskId}`, { method: 'DELETE' })
    await load()
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'delete failed'
  }
}

function fmtDate(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const statusColor: Record<Run['status'], string> = { running: 'info', ok: 'success', error: 'error' }
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-4 sm:px-6 py-3 flex items-center gap-2">
      <UButton to="/agents" variant="ghost" size="sm" icon="i-lucide-arrow-left">
        Agents
      </UButton>
      <span v-if="detail" class="text-muted">/</span>
      <span v-if="detail" class="font-mono">{{ detail.agent.agentName }}</span>
    </header>

    <main class="px-4 sm:px-6 py-6 max-w-4xl mx-auto space-y-6">
      <UAlert v-if="error" color="error" :title="error" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          Loading…
        </p>
      </UCard>

      <template v-else-if="detail">
        <!-- Agent header -->
        <UCard>
          <template #header>
            <h2 class="text-lg font-semibold">
              {{ detail.agent.agentName }}
            </h2>
          </template>
          <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-muted">
              Email
            </dt>
            <dd class="font-mono break-all">
              {{ detail.agent.email }}
            </dd>
            <dt class="text-muted">
              Hostname
            </dt>
            <dd class="font-mono">
              {{ detail.agent.hostname || '—' }}
            </dd>
            <dt class="text-muted">
              Host ID
            </dt>
            <dd class="font-mono text-xs break-all">
              {{ detail.agent.hostId || '—' }}
            </dd>
            <dt class="text-muted">
              Public SSH key
            </dt>
            <dd class="font-mono text-xs break-all">
              {{ detail.agent.pubkeySsh || '—' }}
            </dd>
            <dt class="text-muted">
              First sync
            </dt>
            <dd>{{ fmtDate(detail.agent.firstSeenAt) }}</dd>
            <dt class="text-muted">
              Last sync
            </dt>
            <dd>{{ fmtDate(detail.agent.lastSeenAt) }}</dd>
          </dl>
        </UCard>

        <!-- Tasks -->
        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold">
                Tasks
              </h2>
              <UButton color="primary" size="sm" icon="i-lucide-plus" @click="openCreate">
                New task
              </UButton>
            </div>
          </template>

          <div v-if="detail.tasks.length === 0" class="p-6 text-center text-muted text-sm">
            No tasks yet — create one to schedule the agent.
          </div>
          <ul v-else class="divide-y divide-(--ui-border)">
            <li
              v-for="t in detail.tasks"
              :key="t.taskId"
              class="px-4 py-3 flex items-start justify-between gap-3"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <code class="font-mono">{{ t.taskId }}</code>
                  <span class="font-medium">{{ t.name }}</span>
                  <UBadge v-if="!t.enabled" color="neutral" variant="subtle" size="xs">
                    disabled
                  </UBadge>
                </div>
                <div class="text-xs text-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span><code>{{ t.cron }}</code></span>
                  <span>tools: {{ t.tools.length === 0 ? '(none)' : t.tools.join(', ') }}</span>
                  <span>max steps: {{ t.maxSteps }}</span>
                </div>
              </div>
              <div class="flex items-center gap-1">
                <UButton variant="ghost" size="xs" icon="i-lucide-pencil" @click="openEdit(t)" />
                <UButton variant="ghost" color="error" size="xs" icon="i-lucide-trash-2" @click="remove(t)" />
              </div>
            </li>
          </ul>
        </UCard>

        <!-- Recent runs -->
        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="text-lg font-semibold">
              Recent runs
            </h2>
          </template>
          <div v-if="detail.recentRuns.length === 0" class="p-6 text-center text-muted text-sm">
            No runs yet.
          </div>
          <ul v-else class="divide-y divide-(--ui-border)">
            <li v-for="r in detail.recentRuns" :key="r.id" class="px-4 py-3">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <UBadge :color="(statusColor[r.status] as any)" variant="subtle" size="xs">
                      {{ r.status }}
                    </UBadge>
                    <code class="font-mono text-xs">{{ r.taskId }}</code>
                    <span class="text-xs text-muted">
                      {{ fmtDate(r.startedAt) }}
                      <span v-if="r.finishedAt"> · {{ (r.finishedAt - r.startedAt).toFixed(0) }}s</span>
                    </span>
                  </div>
                  <p v-if="r.finalMessage" class="text-sm mt-1 break-words">
                    {{ r.finalMessage }}
                  </p>
                  <details v-if="r.trace" class="mt-1">
                    <summary class="cursor-pointer text-xs text-muted">
                      trace
                    </summary>
                    <pre class="text-xs mt-1 p-2 bg-(--ui-bg-elevated) rounded overflow-auto max-h-72">{{ JSON.stringify(r.trace, null, 2) }}</pre>
                  </details>
                </div>
              </div>
            </li>
          </ul>
        </UCard>
      </template>
    </main>

    <!-- Task editor modal -->
    <UModal v-model:open="showEditor" :title="editing.isNew ? 'New task' : `Edit ${editing.taskId}`">
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <UFormField label="task_id (slug)" hint="lowercase letters/digits/dashes; immutable">
            <UInput
              v-model="form.task_id"
              :disabled="!editing.isNew"
              placeholder="daily-summary"
              class="w-full font-mono"
            />
          </UFormField>
          <UFormField label="Display name">
            <UInput v-model="form.name" placeholder="Daily Summary" class="w-full" />
          </UFormField>
          <UFormField label="Cron">
            <CronInput v-model="form.cron" />
          </UFormField>
          <UFormField label="System prompt">
            <UTextarea v-model="form.system_prompt" :rows="6" class="w-full" />
          </UFormField>
          <UFormField label="Tools">
            <ToolPicker v-model="form.tools" />
          </UFormField>
          <UFormField label="Max steps">
            <UInput v-model.number="form.max_steps" type="number" :min="1" :max="50" />
          </UFormField>
          <UFormField>
            <UCheckbox v-model="form.enabled" label="Enabled" />
          </UFormField>

          <UAlert v-if="saveError" color="error" :title="saveError" />

          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="ghost" :disabled="saving" @click="showEditor = false">
              Cancel
            </UButton>
            <UButton type="submit" color="primary" :loading="saving">
              {{ editing.isNew ? 'Create' : 'Save' }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
