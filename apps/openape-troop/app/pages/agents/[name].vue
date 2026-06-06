<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

const route = useRoute()
const agentName = computed(() => String(route.params.name))

const { t } = useI18n()
const { fmtDate } = useDateFormat()
const { fmtRelative } = useRelativeTime()
useSeoMeta({ title: () => t('agentDetail.tabTitle', { name: agentName.value }) })

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
    error.value = err?.data?.statusMessage || err?.message || t('agentDetail.error.loadFailed')
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => { if (u) load() }, { immediate: true })
onMounted(() => { if (!user.value) navigateTo('/login') })

// Live-nest indicator. Polls /api/nest/hosts every 30s. If any
// connected nest covers this owner's hosts, the agent is on a
// host that propagates config-updates over WS instead of the 5min
// poll. Pure UX surface — never gates any action.
interface NestHost { host_id: string, hostname: string, version: string, last_seen_at: number }
const nestHosts = ref<NestHost[]>([])
let nestHostsTimer: ReturnType<typeof setInterval> | null = null
async function loadNestHosts() {
  try { nestHosts.value = await ($fetch as any)('/api/nest/hosts') }
  catch { /* badge silently falls back to "offline" */ }
}
onMounted(() => {
  void loadNestHosts()
  nestHostsTimer = setInterval(loadNestHosts, 30_000)
})
onBeforeUnmount(() => { if (nestHostsTimer) clearInterval(nestHostsTimer) })

const nestOnline = computed(() => nestHosts.value.length > 0)
const nestLabel = computed(() => {
  if (!nestOnline.value) return t('agentDetail.nest.offlineLabel')
  const names = nestHosts.value.map(h => h.hostname).join(', ')
  return t('agentDetail.nest.onlineLabel', { names })
})

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
    systemPromptError.value = err?.data?.statusMessage || err?.message || t('common.error.saveFailed')
  }
  finally {
    systemPromptSaving.value = false
  }
}

// Set / update the recipe on this existing agent (INT-4). Re-materializes
// <repo>@<ref> and applies its intent + toolset live (no respawn).
const recipeRef = ref('')
const recipeParams = ref('{}')
const recipeSaving = ref(false)
const recipeError = ref('')
const recipeResult = ref<{ ref: string, required_capabilities: string[] } | null>(null)

async function applyRecipe() {
  if (!recipeRef.value.trim()) return
  recipeSaving.value = true
  recipeError.value = ''
  recipeResult.value = null
  try {
    let params: Record<string, unknown> = {}
    if (recipeParams.value.trim()) params = JSON.parse(recipeParams.value)
    const res = await ($fetch as any)(`/api/agents/${agentName.value}/recipe`, {
      method: 'POST',
      body: { repo_ref: recipeRef.value.trim(), params },
    })
    recipeResult.value = { ref: res.ref, required_capabilities: res.required_capabilities ?? [] }
    // Refresh the system prompt the editor shows.
    if (detail.value) detail.value.agent.systemPrompt = (await ($fetch as any)(`/api/agents/${agentName.value}`)).agent.systemPrompt
  }
  catch (err: any) {
    recipeError.value = err?.data?.statusMessage || err?.message || t('agentDetail.recipe.error.applyFailed')
  }
  finally {
    recipeSaving.value = false
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
    toolsError.value = err?.data?.statusMessage || err?.message || t('common.error.saveFailed')
  }
  finally {
    toolsSaving.value = false
  }
}

// Skills — per-agent SKILL.md catalog. Each row → one
// `<name>/SKILL.md` on the agent host after sync. CRUD via dedicated
// endpoints under /api/agents/[name]/skills/.
interface Skill {
  agentEmail: string
  name: string
  description: string
  body: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}
const skills = ref<Skill[]>([])
const skillsError = ref('')
const skillEditor = ref<{ open: boolean, isNew: boolean, name: string, description: string, body: string, enabled: boolean }>({
  open: false,
  isNew: true,
  name: '',
  description: '',
  body: '',
  enabled: true,
})
const skillSaving = ref(false)

async function loadSkills() {
  if (!agentName.value) return
  skillsError.value = ''
  try { skills.value = await ($fetch as any)(`/api/agents/${agentName.value}/skills`); skillsError.value = '' }
  catch (err: any) { skillsError.value = err?.data?.statusMessage || err?.message || t('agentDetail.skills.error.loadFailed') }
}
watch(detail, (d) => { if (d) loadSkills() })

function openCreateSkill() {
  skillEditor.value = { open: true, isNew: true, name: '', description: '', body: '', enabled: true }
}
function openEditSkill(s: Skill) {
  skillEditor.value = { open: true, isNew: false, name: s.name, description: s.description, body: s.body, enabled: s.enabled }
}
async function saveSkill() {
  if (!agentName.value) return
  skillSaving.value = true
  skillsError.value = ''
  try {
    await ($fetch as any)(`/api/agents/${agentName.value}/skills`, {
      method: 'PUT',
      body: {
        name: skillEditor.value.name,
        description: skillEditor.value.description,
        body: skillEditor.value.body,
        enabled: skillEditor.value.enabled,
      },
    })
    skillEditor.value.open = false
    await loadSkills()
  }
  catch (err: any) {
    skillsError.value = err?.data?.statusMessage || err?.message || t('common.error.saveFailed')
  }
  finally {
    skillSaving.value = false
  }
}
async function deleteSkill(name: string) {
  if (!agentName.value) return
  if (!confirm(t('agentDetail.skills.confirmDelete', { name }))) return
  try {
    await ($fetch as any)(`/api/agents/${agentName.value}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
    await loadSkills()
  }
  catch (err: any) {
    skillsError.value = err?.data?.statusMessage || err?.message || t('common.error.deleteFailed')
  }
}

// Secrets — capability values bound to this agent. Listed by env name
// + status only; troop never returns the value (it's sealed to the
// agent). Add/rotate = PUT, revoke = DELETE (M2c endpoints).
interface SecretRow { env: string, status: 'active' | 'revoked', created_at: number, updated_at: number, revoked_at: number | null }
const secrets = ref<SecretRow[]>([])
const secretsError = ref('')
const newSecret = ref({ env: '', value: '' })
const secretSaving = ref(false)

async function loadSecrets() {
  if (!agentName.value) return
  secretsError.value = ''
  try {
    const res: { secrets: SecretRow[] } = await ($fetch as any)(`/api/agents/${agentName.value}/secrets`)
    secrets.value = res.secrets
  }
  catch (err: any) { secretsError.value = err?.data?.statusMessage || err?.message || t('agentDetail.secrets.error.loadFailed') }
}
watch(detail, (d) => { if (d) loadSecrets() })

async function saveSecret() {
  if (!agentName.value || !newSecret.value.env || !newSecret.value.value) return
  secretSaving.value = true
  secretsError.value = ''
  try {
    await ($fetch as any)(`/api/agents/${agentName.value}/secrets/${encodeURIComponent(newSecret.value.env)}`, {
      method: 'PUT',
      body: { value: newSecret.value.value },
    })
    newSecret.value = { env: '', value: '' }
    await loadSecrets()
  }
  catch (err: any) {
    secretsError.value = err?.data?.statusMessage || err?.message || t('agentDetail.secrets.error.saveFailed')
  }
  finally {
    secretSaving.value = false
  }
}

async function revokeSecret(env: string) {
  if (!agentName.value) return
  if (!confirm(t('agentDetail.secrets.confirmRevoke', { env }))) return
  try {
    await ($fetch as any)(`/api/agents/${agentName.value}/secrets/${encodeURIComponent(env)}`, { method: 'DELETE' })
    await loadSecrets()
  }
  catch (err: any) {
    secretsError.value = err?.data?.statusMessage || err?.message || t('agentDetail.secrets.error.revokeFailed')
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
    saveError.value = err?.data?.statusMessage || err?.message || t('common.error.saveFailed')
  }
  finally {
    saving.value = false
  }
}

async function remove(task: Task) {
  if (!confirm(t('agentDetail.tasks.confirmDelete', { name: task.name }))) return
  try {
    await ($fetch as any)(`/api/agents/${agentName.value}/tasks/${task.taskId}`, { method: 'DELETE' })
    await load()
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('common.error.deleteFailed')
  }
}

const statusColor: Record<Run['status'], string> = { running: 'info', ok: 'success', error: 'error' }

// Destroy-agent state. Two-step UX: button on the page reveals a
// modal asking for typed confirmation (must enter agent name), then
// posts destroy-intent and polls until the nest reports back. On
// success, navigate back to /agents (the DB row is also dropped
// server-side by the WS handler, so refresh would also show the
// removal — but explicit navigateTo is the better UX).
const showDestroy = ref(false)
const destroyConfirmInput = ref('')
const destroying = ref(false)
const destroyError = ref('')
const destroyIntentId = ref('')
let destroyPollTimer: ReturnType<typeof setTimeout> | null = null

function openDestroy() {
  destroyConfirmInput.value = ''
  destroyError.value = ''
  destroyIntentId.value = ''
  showDestroy.value = true
}

async function pollDestroy(): Promise<void> {
  if (!destroyIntentId.value) return
  try {
    const res = await ($fetch as any)(`/api/agents/destroy-intent/${destroyIntentId.value}`)
    if (res.pending) {
      destroyPollTimer = setTimeout(() => { void pollDestroy() }, 2000)
      return
    }
    destroying.value = false
    if (res.ok) {
      showDestroy.value = false
      await navigateTo('/agents')
      return
    }
    destroyError.value = res.error || t('agentDetail.destroy.error.nestFailed')
  }
  catch (err: any) {
    destroying.value = false
    destroyError.value = err?.data?.statusMessage || err?.message || t('agentDetail.destroy.error.pollFailed')
  }
}

async function submitDestroy() {
  destroyError.value = ''
  destroying.value = true
  try {
    const res = await ($fetch as any)('/api/agents/destroy-intent', {
      method: 'POST',
      body: { name: agentName.value },
    })
    destroyIntentId.value = res.intent_id
    destroyPollTimer = setTimeout(() => { void pollDestroy() }, 2000)
  }
  catch (err: any) {
    destroying.value = false
    destroyError.value = err?.data?.statusMessage || err?.message || t('agentDetail.destroy.error.startFailed')
  }
}

onBeforeUnmount(() => { if (destroyPollTimer) clearTimeout(destroyPollTimer) })
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-3 sm:px-6 py-3 flex items-center gap-2 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
      <UButton to="/agents" variant="ghost" size="sm" icon="i-lucide-arrow-left" :ui="{ base: 'shrink-0' }">
        <span class="hidden sm:inline">{{ $t('agentDetail.backToAgents') }}</span>
      </UButton>
      <span v-if="detail" class="font-mono font-semibold truncate flex-1">
        🦍 {{ detail.agent.agentName }}
      </span>
      <span
        class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
        :class="nestOnline ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-500 bg-zinc-800/50'"
        :title="nestLabel"
      >
        {{ nestOnline ? $t('agentDetail.nest.badgeLive') : $t('agentDetail.nest.badgePoll') }}
      </span>
      <LocaleSwitcher />
    </header>

    <main class="px-4 sm:px-6 py-4 sm:py-6 max-w-4xl mx-auto space-y-4 sm:space-y-6">
      <UAlert v-if="error" color="error" :title="error" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          {{ $t('common.loading') }}
        </p>
      </UCard>

      <template v-else-if="detail">
        <!-- Main Session — the ChatGPT-style chat surface. Patrick's
             request: "Im Agent tab wird die Main Session als tab
             (standard) angezeigt." It's the first thing the operator
             sees on this page; everything else (details, system prompt,
             tasks, skills) drops below as collapsed sections.
             Proxies through to chat.openape.ai for now (interim); the
             troop-native backend lands in M5/M6 of plan
             01KSWSHPA4C320VV0BKK98EZ0V. -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <AgentChat :agent-name="detail.agent.agentName" />
        </UCard>

        <!-- Agent metadata. Collapsed by default on mobile because the
             SSH key + email are long strings that crowd out the tasks
             section, which is what the user actually came here to edit. -->
        <UCard :ui="{ body: 'p-0' }">
          <details class="group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-info" class="text-muted size-4" />
                <span class="font-medium">{{ $t('agentDetail.details.title') }}</span>
                <span class="text-xs text-muted">·</span>
                <span class="text-xs text-muted">{{ $t('agentDetail.details.lastSyncShort', { value: fmtRelative(detail.agent.lastSeenAt) }) }}</span>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <dl class="px-4 pb-4 pt-1 space-y-3 text-sm border-t border-(--ui-border)">
              <div>
                <dt class="text-xs text-muted mb-0.5">
                  {{ $t('agentDetail.details.email') }}
                </dt>
                <dd class="font-mono text-xs break-all">
                  {{ detail.agent.email }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted mb-0.5">
                  {{ $t('agentDetail.details.hostname') }}
                </dt>
                <dd class="font-mono">
                  {{ detail.agent.hostname || '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted mb-0.5">
                  {{ $t('agentDetail.details.hostId') }}
                </dt>
                <dd class="font-mono text-xs break-all">
                  {{ detail.agent.hostId || '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted mb-0.5">
                  {{ $t('agentDetail.details.pubkey') }}
                </dt>
                <dd class="font-mono text-xs break-all">
                  {{ detail.agent.pubkeySsh || '—' }}
                </dd>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <dt class="text-xs text-muted mb-0.5">
                    {{ $t('agentDetail.details.firstSync') }}
                  </dt>
                  <dd class="text-sm">
                    {{ fmtDate(detail.agent.firstSeenAt) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted mb-0.5">
                    {{ $t('agentDetail.details.lastSync') }}
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
             question). Saved on blur. Collapsed by default to keep
             the page compact on mobile; the summary-badge surfaces
             the status (set / empty / unsaved) so users know which
             sections deserve a tap. -->
        <UCard :ui="{ body: 'p-0' }">
          <details class="group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-message-square" class="text-muted size-4" />
                <span class="font-medium">{{ $t('agentDetail.systemPrompt.title') }}</span>
                <UBadge v-if="systemPromptDirty" color="warning" variant="subtle" size="xs">
                  {{ $t('common.badge.unsaved') }}
                </UBadge>
                <UBadge v-else-if="systemPromptDraft" color="success" variant="subtle" size="xs">
                  {{ $t('common.badge.set') }}
                </UBadge>
                <UBadge v-else color="neutral" variant="subtle" size="xs">
                  {{ $t('common.badge.empty') }}
                </UBadge>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div class="px-4 pb-4 pt-3 border-t border-(--ui-border)">
              <UTextarea
                v-model="systemPromptDraft"
                :rows="5"
                autoresize
                size="lg"
                class="w-full"
                :ui="{ base: 'w-full' }"
                :placeholder="$t('agentDetail.systemPrompt.placeholder')"
                @blur="saveSystemPrompt"
              />
              <p class="text-xs text-muted mt-2">
                {{ $t('agentDetail.systemPrompt.hint') }}
              </p>
              <UAlert v-if="systemPromptError" color="error" :title="systemPromptError" class="mt-3" />
              <div v-if="systemPromptDirty" class="flex justify-end mt-3">
                <UButton size="sm" color="primary" :loading="systemPromptSaving" @click="saveSystemPrompt">
                  {{ $t('common.save') }}
                </UButton>
              </div>
            </div>
          </details>
        </UCard>

        <!-- Set / update the recipe on this existing agent (INT-4).
             Re-materializes <repo>@<ref> and applies its intent + tools
             live; the nest re-syncs within ~1s. -->
        <UCard :ui="{ body: 'p-0' }">
          <details class="group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-package" class="text-muted size-4" />
                <span class="font-medium">{{ $t('agentDetail.recipe.title') }}</span>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div class="px-4 pb-4 pt-3 border-t border-(--ui-border) space-y-3">
              <UFormField :label="$t('agentDetail.recipe.ref.label')" :description="$t('agentDetail.recipe.ref.description')">
                <UInput v-model="recipeRef" placeholder="openape-ai/coding-agent@main" class="w-full" :ui="{ base: 'w-full' }" />
              </UFormField>
              <UFormField :label="$t('agentDetail.recipe.params.label')" :description="$t('agentDetail.recipe.params.description')">
                <UTextarea v-model="recipeParams" :rows="2" class="w-full" :ui="{ base: 'w-full' }" />
              </UFormField>
              <UAlert v-if="recipeError" color="error" :title="recipeError" />
              <UAlert
                v-if="recipeResult"
                color="success"
                :title="$t('agentDetail.recipe.applied', { ref: recipeResult.ref })"
                :description="recipeResult.required_capabilities.length ? $t('agentDetail.recipe.bindSecrets', { names: recipeResult.required_capabilities.join(', ') }) : $t('agentDetail.recipe.noNewSecrets')"
              />
              <div class="flex justify-end">
                <UButton size="sm" color="primary" :loading="recipeSaving" :disabled="!recipeRef.trim()" @click="applyRecipe">
                  {{ $t('agentDetail.recipe.applyButton') }}
                </UButton>
              </div>
            </div>
          </details>
        </UCard>

        <!-- Agent-level tool whitelist — controls which tools the chat-
             bridge exposes to the LLM during live thread turns. New
             agents start with all tools enabled; narrow as needed. -->
        <UCard :ui="{ body: 'p-0' }">
          <details class="group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-wrench" class="text-muted size-4" />
                <span class="font-medium">{{ $t('agentDetail.tools.title') }}</span>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ $t('agentDetail.tools.selectedCount', { n: toolsDraft.length }) }}
                </UBadge>
                <UBadge v-if="toolsDirty" color="warning" variant="subtle" size="xs">
                  {{ $t('common.badge.unsaved') }}
                </UBadge>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div class="px-4 pb-4 pt-3 border-t border-(--ui-border)">
              <p class="text-xs text-muted mb-3">
                {{ $t('agentDetail.tools.hint') }}
              </p>
              <ToolPicker v-model="toolsDraft" :disabled="toolsSaving" />
              <UAlert v-if="toolsError" color="error" :title="toolsError" class="mt-3" />
              <div v-if="toolsDirty" class="flex justify-end mt-3">
                <UButton size="sm" color="primary" :loading="toolsSaving" @click="saveTools">
                  Save tools
                </UButton>
              </div>
            </div>
          </details>
        </UCard>

        <!-- Skills — lazy-load SKILL.md catalog -->
        <UCard :ui="{ body: 'p-0' }">
          <details class="group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-book-open" class="text-muted size-4" />
                <span class="font-medium">{{ $t('agentDetail.skills.title') }}</span>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ skills.length }}
                </UBadge>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div class="border-t border-(--ui-border)">
              <div class="flex items-start justify-between gap-3 px-4 py-3">
                <p class="text-xs text-muted">
                  {{ $t('agentDetail.skills.hint') }}
                </p>
                <UButton color="primary" size="sm" icon="i-lucide-plus" :ui="{ base: 'shrink-0' }" @click="openCreateSkill">
                  {{ $t('agentDetail.skills.newButton') }}
                </UButton>
              </div>
              <UAlert v-if="skillsError" color="error" :title="skillsError" class="m-4" />
              <i18n-t v-if="skills.length === 0" keypath="agentDetail.skills.empty" tag="div" class="px-4 pb-6 pt-2 text-center text-muted text-sm">
                <template #pkg>
                  <code class="text-zinc-300">@openape/ape-agent</code>
                </template>
              </i18n-t>
              <ul v-else class="divide-y divide-(--ui-border)">
                <li v-for="s in skills" :key="s.name">
                  <button
                    type="button"
                    class="w-full text-left px-4 py-3 active:bg-zinc-900 transition-colors flex items-start gap-3"
                    @click="openEditSkill(s)"
                  >
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap mb-1">
                        <span class="font-medium text-base">{{ s.name }}</span>
                        <UBadge v-if="!s.enabled" color="neutral" variant="subtle" size="xs">
                          {{ $t('common.badge.disabled') }}
                        </UBadge>
                      </div>
                      <div class="text-xs text-muted line-clamp-2">
                        {{ s.description }}
                      </div>
                    </div>
                    <UButton
                      size="sm"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      :aria-label="$t('agentDetail.skills.deleteAria')"
                      @click.stop="deleteSkill(s.name)"
                    />
                  </button>
                </li>
              </ul>
            </div>
          </details>
        </UCard>

        <!-- Skill editor modal -->
        <UModal v-model:open="skillEditor.open">
          <template #content>
            <div class="p-5 space-y-4">
              <h3 class="text-lg font-semibold">
                {{ skillEditor.isNew ? $t('agentDetail.skills.editor.titleNew') : $t('agentDetail.skills.editor.titleEdit', { name: skillEditor.name }) }}
              </h3>
              <UFormField :label="$t('agentDetail.skills.editor.name.label')" :description="skillEditor.isNew ? $t('agentDetail.skills.editor.name.descriptionNew') : $t('agentDetail.skills.editor.name.descriptionImmutable')">
                <UInput v-model="skillEditor.name" :disabled="!skillEditor.isNew || skillSaving" placeholder="iurio" />
              </UFormField>
              <UFormField :label="$t('agentDetail.skills.editor.description.label')" :description="$t('agentDetail.skills.editor.description.description')">
                <UInput v-model="skillEditor.description" :disabled="skillSaving" :placeholder="$t('agentDetail.skills.editor.description.placeholder')" />
              </UFormField>
              <UFormField :label="$t('agentDetail.skills.editor.body.label')" :description="$t('agentDetail.skills.editor.body.description')">
                <UTextarea v-model="skillEditor.body" :rows="14" :disabled="skillSaving" :placeholder="$t('agentDetail.skills.editor.body.placeholder')" />
              </UFormField>
              <UFormField :label="$t('agentDetail.skills.editor.enabled.label')" :description="$t('agentDetail.skills.editor.enabled.description')">
                <USwitch v-model="skillEditor.enabled" :disabled="skillSaving" />
              </UFormField>
              <div class="flex justify-end gap-2">
                <UButton variant="ghost" :disabled="skillSaving" @click="skillEditor.open = false">
                  {{ $t('common.cancel') }}
                </UButton>
                <UButton color="primary" :loading="skillSaving" @click="saveSkill">
                  {{ $t('common.save') }}
                </UButton>
              </div>
            </div>
          </template>
        </UModal>

        <!-- Secrets — capability values, sealed to the agent -->
        <UCard :ui="{ body: 'p-0' }">
          <details class="group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-key-round" class="text-muted size-4" />
                <span class="font-medium">{{ $t('agentDetail.secrets.title') }}</span>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ secrets.filter(s => s.status === 'active').length }}
                </UBadge>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div class="border-t border-(--ui-border)">
              <p class="text-xs text-muted px-4 py-3">
                {{ $t('agentDetail.secrets.hint') }}
              </p>
              <ChatgptConnect :agent-name="agentName" @connected="loadSecrets" />
              <UAlert v-if="secretsError" color="error" :title="secretsError" class="m-4" />
              <ul v-if="secrets.length > 0" class="divide-y divide-(--ui-border)">
                <li v-for="s in secrets" :key="s.env" class="px-4 py-3 flex items-center gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <code class="font-medium">{{ s.env }}</code>
                      <UBadge :color="s.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="xs">
                        {{ $t(`agentDetail.secrets.status.${s.status}`) }}
                      </UBadge>
                    </div>
                  </div>
                  <UButton
                    v-if="s.status === 'active'"
                    size="sm"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    :aria-label="$t('agentDetail.secrets.revokeAria')"
                    @click="revokeSecret(s.env)"
                  />
                </li>
              </ul>
              <div class="px-4 py-3 border-t border-(--ui-border) space-y-2">
                <div class="flex items-stretch gap-2">
                  <UInput
                    v-model="newSecret.env"
                    :placeholder="$t('agentDetail.secrets.envPlaceholder')"
                    class="flex-1"
                    :ui="{ base: 'w-full' }"
                    :disabled="secretSaving"
                  />
                  <UInput
                    v-model="newSecret.value"
                    type="password"
                    :placeholder="$t('agentDetail.secrets.valuePlaceholder')"
                    class="flex-1"
                    :ui="{ base: 'w-full' }"
                    :disabled="secretSaving"
                  />
                  <UButton
                    color="primary"
                    :loading="secretSaving"
                    :disabled="!newSecret.env || !newSecret.value"
                    @click="saveSecret"
                  >
                    {{ $t('agentDetail.secrets.setButton') }}
                  </UButton>
                </div>
                <p class="text-[11px] text-muted">
                  {{ $t('agentDetail.secrets.casingHint') }}
                </p>
              </div>
            </div>
          </details>
        </UCard>

        <!-- Tasks -->
        <UCard :ui="{ body: 'p-0' }">
          <details class="group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-clock" class="text-muted size-4" />
                <span class="font-medium">{{ $t('agentDetail.tasks.title') }}</span>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ detail.tasks.length }}
                </UBadge>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div class="border-t border-(--ui-border)">
              <div class="flex items-center justify-end px-4 py-3">
                <UButton color="primary" size="sm" icon="i-lucide-plus" @click="openCreate">
                  {{ $t('agentDetail.tasks.newButton') }}
                </UButton>
              </div>
              <div v-if="detail.tasks.length === 0" class="px-4 pb-6 text-center text-muted text-sm">
                {{ $t('agentDetail.tasks.empty') }}
              </div>
              <ul v-else class="divide-y divide-(--ui-border)">
                <li v-for="task in detail.tasks" :key="task.taskId">
                  <button
                    type="button"
                    class="w-full text-left px-4 py-4 active:bg-zinc-900 transition-colors flex items-start gap-3"
                    @click="openEdit(task)"
                  >
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap mb-1">
                        <span class="font-medium text-base">{{ task.name }}</span>
                        <UBadge v-if="!task.enabled" color="neutral" variant="subtle" size="xs">
                          {{ $t('common.badge.disabled') }}
                        </UBadge>
                      </div>
                      <div class="flex items-center gap-2 text-xs text-muted">
                        <UIcon name="i-lucide-clock" class="size-3.5 shrink-0" />
                        <code class="font-mono">{{ task.cron }}</code>
                      </div>
                      <p v-if="task.userPrompt" class="text-xs text-muted mt-1 line-clamp-2">
                        {{ task.userPrompt }}
                      </p>
                      <div class="flex items-center gap-2 text-xs text-muted mt-1.5 flex-wrap">
                        <span v-if="task.tools.length > 0" class="flex items-center gap-1">
                          <UIcon name="i-lucide-wrench" class="size-3.5 shrink-0" />
                          {{ $t('agentDetail.tasks.toolsCount', task.tools.length) }}
                        </span>
                        <span class="flex items-center gap-1">
                          <UIcon name="i-lucide-list-checks" class="size-3.5 shrink-0" />
                          {{ $t('agentDetail.tasks.maxSteps', { n: task.maxSteps }) }}
                        </span>
                      </div>
                    </div>
                    <UButton
                      variant="ghost"
                      color="error"
                      size="sm"
                      icon="i-lucide-trash-2"
                      :ui="{ base: 'shrink-0' }"
                      @click.stop="remove(task)"
                    />
                  </button>
                </li>
              </ul>
            </div>
          </details>
        </UCard>

        <!-- Recent runs -->
        <UCard :ui="{ body: 'p-0' }">
          <details class="group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-history" class="text-muted size-4" />
                <span class="font-medium">{{ $t('agentDetail.runs.title') }}</span>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ detail.recentRuns.length }}
                </UBadge>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div class="border-t border-(--ui-border)">
              <div v-if="detail.recentRuns.length === 0" class="px-4 py-6 text-center text-muted text-sm">
                {{ $t('agentDetail.runs.empty') }}
              </div>
              <ul v-else class="divide-y divide-(--ui-border)">
                <li v-for="r in detail.recentRuns" :key="r.id" class="px-4 py-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <UBadge :color="(statusColor[r.status] as any)" variant="subtle" size="xs">
                          {{ $t(`agentDetail.runs.status.${r.status}`) }}
                        </UBadge>
                        <code class="font-mono text-xs">{{ r.taskId }}</code>
                        <span class="text-xs text-muted">
                          {{ fmtDate(r.startedAt) }}
                          <span v-if="r.finishedAt"> · {{ $t('agentDetail.runs.elapsedSec', { n: (r.finishedAt - r.startedAt).toFixed(0) }) }}</span>
                        </span>
                      </div>
                      <p v-if="r.finalMessage" class="text-sm mt-1 break-words">
                        {{ r.finalMessage }}
                      </p>
                      <details v-if="r.trace" class="mt-1">
                        <summary class="cursor-pointer text-xs text-muted">
                          {{ $t('agentDetail.runs.trace') }}
                        </summary>
                        <pre class="text-xs mt-1 p-2 bg-(--ui-bg-elevated) rounded overflow-auto max-h-72">{{ JSON.stringify(r.trace, null, 2) }}</pre>
                      </details>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </details>
        </UCard>
      </template>

      <!-- Danger zone — separated visually so it doesn't sit next to
           normal save buttons. Two-step destroy (type-the-name confirm
           in a modal) prevents accidental clicks on a phone, and
           matches the gravity of the operation: full Phase-G teardown
           on the nest (IdP-deregister + pm2 delete + root cleanup
           script + agent-home wipe). -->
      <section class="mt-12 pt-6 border-t border-red-500/20">
        <h2 class="text-sm font-medium text-red-400 mb-1">
          {{ $t('agentDetail.danger.title') }}
        </h2>
        <p class="text-xs text-muted mb-3">
          {{ $t('agentDetail.danger.hint') }}
        </p>
        <UButton color="error" variant="soft" icon="i-lucide-trash-2" @click="openDestroy">
          {{ $t('agentDetail.danger.deleteButton') }}
        </UButton>
      </section>
    </main>

    <UModal v-model:open="showDestroy" :title="$t('agentDetail.destroy.title')" :ui="{ content: 'sm:max-w-md' }">
      <template #body>
        <div class="space-y-4">
          <i18n-t keypath="agentDetail.destroy.body" tag="p" class="text-sm">
            <template #name>
              <span class="font-mono font-semibold">{{ agentName }}</span>
            </template>
          </i18n-t>
          <UFormField :label="$t('agentDetail.destroy.typeToConfirm', { name: agentName })">
            <UInput v-model="destroyConfirmInput" :placeholder="agentName" :disabled="destroying" autocomplete="off" />
          </UFormField>
          <UAlert v-if="destroyError" color="error" :title="destroyError" />
          <div v-if="destroyIntentId && !destroyError" class="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex items-start gap-2">
            <UIcon name="i-lucide-loader-circle" class="animate-spin shrink-0 size-4 mt-0.5" />
            <div>
              <div class="font-medium">
                {{ $t('agentDetail.destroy.pending.title') }}
              </div>
              <div class="text-muted mt-1">
                {{ $t('agentDetail.destroy.pending.hint') }}
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex flex-row-reverse w-full gap-2">
          <UButton
            color="error"
            :loading="destroying"
            :disabled="destroying || destroyConfirmInput !== agentName"
            @click="submitDestroy"
          >
            {{ $t('agentDetail.destroy.confirmButton') }}
          </UButton>
          <UButton variant="ghost" :disabled="destroying" @click="showDestroy = false">
            {{ $t('common.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Task editor modal — fullscreen on mobile so the keyboard
         doesn't push the save button under the textarea. -->
    <UModal
      v-model:open="showEditor"
      :title="editing.isNew ? $t('agentDetail.taskEditor.titleNew') : $t('agentDetail.taskEditor.titleEdit', { id: editing.taskId })"
      fullscreen
      :ui="{ content: 'sm:max-w-2xl sm:max-h-[90vh]' }"
    >
      <template #body>
        <form class="space-y-5" @submit.prevent="save">
          <UFormField label="task_id" :hint="$t('agentDetail.taskEditor.taskId.hint')" :required="editing.isNew">
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
          <UFormField :label="$t('agentDetail.taskEditor.displayName')" required>
            <UInput v-model="form.name" placeholder="Daily Summary" size="lg" class="w-full" />
          </UFormField>
          <UFormField :label="$t('agentDetail.taskEditor.cron.label')" :hint="$t('agentDetail.taskEditor.cron.hint')">
            <CronInput v-model="form.cron" />
          </UFormField>
          <UFormField :label="$t('agentDetail.taskEditor.userPrompt.label')" :hint="$t('agentDetail.taskEditor.userPrompt.hint')" required>
            <UTextarea
              v-model="form.user_prompt"
              :rows="8"
              autoresize
              size="lg"
              class="w-full"
              :placeholder="$t('agentDetail.taskEditor.userPrompt.placeholder')"
            />
          </UFormField>
          <UFormField :label="$t('agentDetail.taskEditor.toolsLabel')">
            <ToolPicker v-model="form.tools" />
          </UFormField>
          <UFormField :label="$t('agentDetail.taskEditor.maxStepsLabel')">
            <UInput v-model.number="form.max_steps" type="number" :min="1" :max="50" size="lg" class="w-full" />
          </UFormField>
          <UFormField>
            <UCheckbox v-model="form.enabled" :label="$t('agentDetail.taskEditor.enabledLabel')" />
          </UFormField>

          <UAlert v-if="saveError" color="error" :title="saveError" />
        </form>
      </template>
      <template #footer>
        <div class="flex flex-row-reverse w-full gap-2">
          <UButton type="submit" color="primary" :loading="saving" size="lg" class="flex-1 sm:flex-none justify-center" @click="save">
            {{ editing.isNew ? $t('agentDetail.taskEditor.createButton') : $t('agentDetail.taskEditor.saveButton') }}
          </UButton>
          <UButton variant="ghost" :disabled="saving" size="lg" @click="showEditor = false">
            {{ $t('common.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
