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
  systemPrompt: string
  /** Tool-name whitelist — drives which tools the chat-bridge exposes
   *  to the LLM during live thread turns. Defaults to all known tools
   *  on first sync; owner narrows here. */
  tools: string[]
  firstSeenAt: number | null
  lastSeenAt: number | null
  createdAt: number
}
interface Task {
  agentEmail: string
  taskId: string
  name: string
  cron: string
  userPrompt: string
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

// Agent-level system prompt editor — saved on blur via PATCH
// /api/agents/[name]. The bridge daemon re-reads agent.json on every
// inbound chat message, and `apes agents run` reads it at run start,
// so edits propagate within one sync cycle (~5min) without restart.
const systemPromptDraft = ref('')
const systemPromptSaving = ref(false)
const systemPromptError = ref('')
const systemPromptDirty = computed(() =>
  systemPromptDraft.value !== (detail.value?.agent.systemPrompt ?? ''),
)

watch(detail, (d) => {
  if (d) systemPromptDraft.value = d.agent.systemPrompt ?? ''
}, { immediate: true })

async function saveSystemPrompt() {
  if (!systemPromptDirty.value) return
  systemPromptSaving.value = true
  systemPromptError.value = ''
  try {
    await ($fetch as any)(`/api/agents/${agentName.value}`, {
      method: 'PATCH',
      body: { system_prompt: systemPromptDraft.value },
    })
    if (detail.value) detail.value.agent.systemPrompt = systemPromptDraft.value
  }
  catch (err: any) {
    systemPromptError.value = err?.data?.statusMessage || err?.message || 'save failed'
  }
  finally {
    systemPromptSaving.value = false
  }
}

// Agent-level tool whitelist editor — saved on toggle via PATCH
// /api/agents/[name] with `tools: string[]`. The bridge re-reads the
// list from agent.json on every new chat thread, so changes
// propagate within the next sync (~5min).
const toolsDraft = ref<string[]>([])
const toolsSaving = ref(false)
const toolsError = ref('')
const toolsDirty = computed(() => {
  const a = (detail.value?.agent.tools ?? []).toSorted()
  const b = toolsDraft.value.toSorted()
  return a.length !== b.length || a.some((v, i) => v !== b[i])
})

watch(detail, (d) => {
  if (d) toolsDraft.value = [...(d.agent.tools ?? [])]
}, { immediate: true })

async function saveTools() {
  if (!toolsDirty.value) return
  toolsSaving.value = true
  toolsError.value = ''
  try {
    await ($fetch as any)(`/api/agents/${agentName.value}`, {
      method: 'PATCH',
      body: { tools: toolsDraft.value },
    })
    if (detail.value) detail.value.agent.tools = [...toolsDraft.value]
  }
  catch (err: any) {
    toolsError.value = err?.data?.statusMessage || err?.message || 'save failed'
  }
  finally {
    toolsSaving.value = false
  }
}

// Task editor state
const showEditor = ref(false)
const editing = ref<{ taskId: string, isNew: boolean }>({ taskId: '', isNew: true })
const form = ref({
  task_id: '',
  name: '',
  cron: '*/5 * * * *',
  user_prompt: '',
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
    user_prompt: '',
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
    user_prompt: t.userPrompt,
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
          user_prompt: form.value.user_prompt,
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

function fmtRelative(ts: number | null): string {
  if (!ts) return 'never'
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

const statusColor: Record<Run['status'], string> = { running: 'info', ok: 'success', error: 'error' }
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-3 sm:px-6 py-3 flex items-center gap-2 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
      <UButton to="/agents" variant="ghost" size="sm" icon="i-lucide-arrow-left" :ui="{ base: 'shrink-0' }">
        <span class="hidden sm:inline">Agents</span>
      </UButton>
      <span v-if="detail" class="font-mono font-semibold truncate flex-1">
        🦍 {{ detail.agent.agentName }}
      </span>
    </header>

    <main class="px-4 sm:px-6 py-4 sm:py-6 max-w-4xl mx-auto space-y-4 sm:space-y-6">
      <UAlert v-if="error" color="error" :title="error" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          Loading…
        </p>
      </UCard>

      <template v-else-if="detail">
        <!-- Agent metadata. Collapsed by default on mobile because the
             SSH key + email are long strings that crowd out the tasks
             section, which is what the user actually came here to edit. -->
        <UCard :ui="{ body: 'p-0' }">
          <details class="group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-info" class="text-muted size-4" />
                <span class="font-medium">Agent details</span>
                <span class="text-xs text-muted">·</span>
                <span class="text-xs text-muted">last sync {{ fmtRelative(detail.agent.lastSeenAt) }}</span>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <dl class="px-4 pb-4 pt-1 space-y-3 text-sm border-t border-(--ui-border)">
              <div>
                <dt class="text-xs text-muted mb-0.5">
                  Email
                </dt>
                <dd class="font-mono text-xs break-all">
                  {{ detail.agent.email }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted mb-0.5">
                  Hostname
                </dt>
                <dd class="font-mono">
                  {{ detail.agent.hostname || '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted mb-0.5">
                  Host ID
                </dt>
                <dd class="font-mono text-xs break-all">
                  {{ detail.agent.hostId || '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted mb-0.5">
                  Public SSH key
                </dt>
                <dd class="font-mono text-xs break-all">
                  {{ detail.agent.pubkeySsh || '—' }}
                </dd>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <dt class="text-xs text-muted mb-0.5">
                    First sync
                  </dt>
                  <dd class="text-sm">
                    {{ fmtDate(detail.agent.firstSeenAt) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted mb-0.5">
                    Last sync
                  </dt>
                  <dd class="text-sm">
                    {{ fmtDate(detail.agent.lastSeenAt) }}
                  </dd>
                </div>
              </div>
            </dl>
          </details>
        </UCard>

        <!-- Agent-level system prompt — applies to every chat message
             AND every cron task run. Tasks supply the user-prompt
             (what to do); chat supplies the user-message (the human's
             question). Saved on blur. -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-lg font-semibold">
                System prompt
              </h2>
              <UBadge v-if="systemPromptDirty" color="warning" variant="subtle" size="xs">
                unsaved
              </UBadge>
              <UBadge v-else-if="systemPromptDraft" color="success" variant="subtle" size="xs">
                set
              </UBadge>
              <UBadge v-else color="neutral" variant="subtle" size="xs">
                empty
              </UBadge>
            </div>
          </template>
          <UTextarea
            v-model="systemPromptDraft"
            :rows="5"
            autoresize
            size="lg"
            class="w-full"
            placeholder="Du bist Igor, ein loyaler kleiner Agent. Sprich kurz und auf Deutsch. Frag nach wenn etwas unklar ist."
            @blur="saveSystemPrompt"
          />
          <p class="text-xs text-muted mt-2">
            Persönlichkeit, Stil, Grundregeln — gilt für jede Nachricht im Chat und für jeden Task-Run. Wird via Sync (~5min) auf den Agent-Host übertragen.
          </p>
          <UAlert v-if="systemPromptError" color="error" :title="systemPromptError" class="mt-3" />
          <div v-if="systemPromptDirty" class="flex justify-end mt-3">
            <UButton size="sm" color="primary" :loading="systemPromptSaving" @click="saveSystemPrompt">
              Save
            </UButton>
          </div>
        </UCard>

        <!-- Agent-level tool whitelist — controls which tools the chat-
             bridge exposes to the LLM during live thread turns. New
             agents start with all tools enabled; narrow as needed. -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-lg font-semibold">
                Tools
              </h2>
              <div class="flex items-center gap-2">
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ toolsDraft.length }} selected
                </UBadge>
                <UBadge v-if="toolsDirty" color="warning" variant="subtle" size="xs">
                  unsaved
                </UBadge>
              </div>
            </div>
          </template>
          <p class="text-xs text-muted mb-3">
            Welche Tools darf der Agent im Chat verwenden? Default: alle. Nach
            Speichern via Sync (~5min) auf den Agent-Host übertragen — kein
            Bridge-Restart nötig (jeder neue Chat-Thread liest die Liste frisch).
          </p>
          <ToolPicker v-model="toolsDraft" :disabled="toolsSaving" />
          <UAlert v-if="toolsError" color="error" :title="toolsError" class="mt-3" />
          <div v-if="toolsDirty" class="flex justify-end mt-3">
            <UButton size="sm" color="primary" :loading="toolsSaving" @click="saveTools">
              Save tools
            </UButton>
          </div>
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
            No tasks yet — tap "New task" to schedule the agent.
          </div>
          <ul v-else class="divide-y divide-(--ui-border)">
            <li v-for="t in detail.tasks" :key="t.taskId">
              <button
                type="button"
                class="w-full text-left px-4 py-4 active:bg-zinc-900 transition-colors flex items-start gap-3"
                @click="openEdit(t)"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap mb-1">
                    <span class="font-medium text-base">{{ t.name }}</span>
                    <UBadge v-if="!t.enabled" color="neutral" variant="subtle" size="xs">
                      disabled
                    </UBadge>
                  </div>
                  <div class="flex items-center gap-2 text-xs text-muted">
                    <UIcon name="i-lucide-clock" class="size-3.5 shrink-0" />
                    <code class="font-mono">{{ t.cron }}</code>
                  </div>
                  <p v-if="t.userPrompt" class="text-xs text-muted mt-1 line-clamp-2">
                    {{ t.userPrompt }}
                  </p>
                  <div class="flex items-center gap-2 text-xs text-muted mt-1.5 flex-wrap">
                    <span v-if="t.tools.length > 0" class="flex items-center gap-1">
                      <UIcon name="i-lucide-wrench" class="size-3.5 shrink-0" />
                      {{ t.tools.length }} {{ t.tools.length === 1 ? 'tool' : 'tools' }}
                    </span>
                    <span class="flex items-center gap-1">
                      <UIcon name="i-lucide-list-checks" class="size-3.5 shrink-0" />
                      max {{ t.maxSteps }} steps
                    </span>
                  </div>
                </div>
                <UButton
                  variant="ghost"
                  color="error"
                  size="sm"
                  icon="i-lucide-trash-2"
                  :ui="{ base: 'shrink-0' }"
                  @click.stop="remove(t)"
                />
              </button>
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

    <!-- Task editor modal — fullscreen on mobile so the keyboard
         doesn't push the save button under the textarea. -->
    <UModal
      v-model:open="showEditor"
      :title="editing.isNew ? 'New task' : `Edit ${editing.taskId}`"
      fullscreen
      :ui="{ content: 'sm:max-w-2xl sm:max-h-[90vh]' }"
    >
      <template #body>
        <form class="space-y-5" @submit.prevent="save">
          <UFormField label="task_id" hint="lowercase letters, digits, dashes — immutable" :required="editing.isNew">
            <UInput
              v-model="form.task_id"
              :disabled="!editing.isNew"
              placeholder="daily-summary"
              size="lg"
              class="w-full font-mono"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              pattern="[a-z][a-z0-9-]*"
              @input="form.task_id = String($event.target.value).toLowerCase().replace(/[^a-z0-9-]/g, '')"
            />
          </UFormField>
          <UFormField label="Display name" required>
            <UInput v-model="form.name" placeholder="Daily Summary" size="lg" class="w-full" />
          </UFormField>
          <UFormField label="When to run" hint="Cron syntax — see preview below">
            <CronInput v-model="form.cron" />
          </UFormField>
          <UFormField label="What should run?" hint="The job for this run — agent's persona/style is set on the agent itself." required>
            <UTextarea
              v-model="form.user_prompt"
              :rows="8"
              autoresize
              size="lg"
              class="w-full"
              placeholder="Lese mein Postfach durch und mach mir eine Zusammenfassung der wichtigsten neuen Mails."
            />
          </UFormField>
          <UFormField label="Tools available">
            <ToolPicker v-model="form.tools" />
          </UFormField>
          <UFormField label="Max tool-call rounds per run">
            <UInput v-model.number="form.max_steps" type="number" :min="1" :max="50" size="lg" class="w-full" />
          </UFormField>
          <UFormField>
            <UCheckbox v-model="form.enabled" label="Enabled" />
          </UFormField>

          <UAlert v-if="saveError" color="error" :title="saveError" />
        </form>
      </template>
      <template #footer>
        <div class="flex flex-row-reverse w-full gap-2">
          <UButton type="submit" color="primary" :loading="saving" size="lg" class="flex-1 sm:flex-none justify-center" @click="save">
            {{ editing.isNew ? 'Create task' : 'Save changes' }}
          </UButton>
          <UButton variant="ghost" :disabled="saving" size="lg" @click="showEditor = false">
            Cancel
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
