<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser } = useOpenApeAuth()
const route = useRoute()
const teamId = computed(() => String(route.params.id))

interface TeamMember { email: string, role: 'owner' | 'editor' | 'viewer', joined_at: number }
interface TaskCount { open: number, doing: number, done: number, archived: number, total: number }
type LaneStatus = 'open' | 'doing' | 'done'
interface Lane { id: string, name: string, status: LaneStatus }
interface TeamDetail {
  id: string
  name: string
  description: string | null
  created_at: number
  lanes: Lane[]
  members: TeamMember[]
  task_count: TaskCount
}

type TaskStatus = 'open' | 'doing' | 'done' | 'archived'
type TaskPriority = 'low' | 'med' | 'high' | null
interface Task {
  id: string
  team_id: string
  title: string
  notes: string
  status: TaskStatus
  priority: TaskPriority
  due_at: number | null
  assignee_email: string | null
  lane_id: string | null
  sort_order: number
  remind_at: number | null
  reminder_count: number
  last_reminder_at: number | null
  reminder_max: number
  context_url: string | null
  context_summary: string | null
  owner_email: string
  created_at: number
  updated_at: number
  updated_by: string
  completed_at: number | null
}

interface InviteSummary {
  id: string
  created_by: string
  note: string | null
  max_uses: number
  used_count: number
  expires_at: number
  created_at: number
}

const detail = ref<TeamDetail | null>(null)
const tasks = ref<Task[]>([])
const loading = ref(true)
const error = ref('')

const newTitle = ref('')
const adding = ref(false)
const addError = ref('')

const showMembers = ref(false)
const showInvites = ref(false)

const invites = ref<InviteSummary[]>([])
const invitesLoading = ref(false)
const invitesError = ref('')

const showInviteModal = ref(false)
const inviteMaxUses = ref(5)
const inviteExpiresIn = ref('7d')
const inviteNote = ref('')
const creating = ref(false)
const createError = ref('')
const createdUrl = ref('')
const copied = ref(false)

// Task-edit sheet state
const editingTask = ref<Task | null>(null)
const editTitle = ref('')
const editLaneId = ref('')
const editNotes = ref('')
const editDueLocal = ref('')
const editPriority = ref<'' | 'low' | 'med' | 'high'>('')
const editAssignee = ref('')
const editRemindLocal = ref('')
const editContextUrl = ref('')
const editContextSummary = ref('')
const showReminder = ref(false)
const showAdvanced = ref(false)

const priorityLabels: Record<string, string> = { low: 'Niedrig', med: 'Mittel', high: 'Hoch' }
// Compact one-line summary for the collapsed "Details" row so nothing hides silently.
const detailsSummary = computed(() => {
  const parts: string[] = []
  if (editPriority.value) parts.push(priorityLabels[editPriority.value] ?? editPriority.value)
  if (editDueLocal.value) parts.push(dueLabel(localInputToUnix(editDueLocal.value)) ?? '')
  if (editAssignee.value) parts.push(editAssignee.value)
  return parts.filter(Boolean).join(' · ')
})
const reminderSummary = computed(() =>
  editRemindLocal.value ? (dueLabel(localInputToUnix(editRemindLocal.value)) ?? '') : '',
)
const saving = ref(false)
const editError = ref('')

// List-settings sheet state
const showListSettings = ref(false)
const settingsName = ref('')
const settingsDescription = ref('')
const settingsLanes = ref<Lane[]>([])
const settingsError = ref('')
const settingsSaving = ref(false)
const settingsDeleting = ref(false)

const laneStatusOptions: { label: string, value: LaneStatus }[] = [
  { label: 'Offen', value: 'open' },
  { label: 'In Arbeit', value: 'doing' },
  { label: 'Fertig', value: 'done' },
]

function addLane() {
  settingsLanes.value.push({ id: '', name: '', status: 'open' })
}
function removeLane(idx: number) {
  settingsLanes.value.splice(idx, 1)
}
function moveLane(idx: number, dir: -1 | 1) {
  const to = idx + dir
  if (to < 0 || to >= settingsLanes.value.length) return
  const arr = settingsLanes.value
  const moved = arr[idx]!
  arr.splice(idx, 1)
  arr.splice(to, 0, moved)
}
function applyDevPreset() {
  settingsLanes.value = [
    { id: '', name: 'Backlog', status: 'open' },
    { id: '', name: 'Ready', status: 'open' },
    { id: '', name: 'Doing', status: 'doing' },
    { id: '', name: 'Review', status: 'doing' },
    { id: '', name: 'Done', status: 'done' },
  ]
}

const lanes = computed<Lane[]>(() => detail.value?.lanes ?? [])
const activeLaneId = ref('')

// Mirror of server/utils/lanes.ts effectiveLaneId: an explicit, still-valid
// lane wins; otherwise a task falls into the first lane of its status bucket.
function effectiveLane(t: Task): string {
  if (t.lane_id && lanes.value.some(l => l.id === t.lane_id)) return t.lane_id
  const bucket: LaneStatus = t.status === 'archived' ? 'done' : t.status
  const match = lanes.value.find(l => l.status === bucket) ?? lanes.value[0]
  return match?.id ?? ''
}

const activeLaneName = computed(() => lanes.value.find(l => l.id === activeLaneId.value)?.name ?? '')
const isDoneLane = computed(() => lanes.value.find(l => l.id === activeLaneId.value)?.status === 'done')

const laneCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const l of lanes.value) counts[l.id] = 0
  for (const t of tasks.value) {
    if (t.status === 'archived') continue
    const id = effectiveLane(t)
    if (id in counts) counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
})

const activeLaneTasks = computed(() =>
  tasks.value
    .filter(t => t.status !== 'archived' && effectiveLane(t) === activeLaneId.value)
    .sort((a, b) => {
      // Done lanes read newest-completed-first; others by manual order.
      if (isDoneLane.value) return (b.completed_at ?? 0) - (a.completed_at ?? 0)
      return a.sort_order - b.sort_order || a.created_at - b.created_at
    }),
)

const callerRole = computed<'owner' | 'editor' | 'viewer' | null>(() => {
  if (!detail.value || !user.value) return null
  return detail.value.members.find(m => m.email === user.value?.sub)?.role ?? null
})
const canEdit = computed(() => callerRole.value === 'owner' || callerRole.value === 'editor')
const isOwner = computed(() => callerRole.value === 'owner')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await Promise.all([loadDetail(), loadTasks()])
  loading.value = false
})

async function loadDetail() {
  try {
    detail.value = await ($fetch as any)(`/api/teams/${teamId.value}`) as TeamDetail
    // Keep the active lane valid: default to the first lane, preserve a still-
    // existing selection across reloads (e.g. after editing lanes).
    if (!lanes.value.some(l => l.id === activeLaneId.value)) {
      activeLaneId.value = lanes.value[0]?.id ?? ''
    }
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to load team'
    detail.value = null
  }
}

async function loadTasks() {
  try {
    tasks.value = await ($fetch as any)(`/api/teams/${teamId.value}/tasks?status=open,doing,done`) as Task[]
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to load tasks'
  }
}

async function addTask() {
  const title = newTitle.value.trim()
  if (!title || adding.value) return
  adding.value = true
  addError.value = ''
  try {
    const created = await ($fetch as any)(`/api/teams/${teamId.value}/tasks`, {
      method: 'POST',
      body: { title, lane_id: activeLaneId.value || undefined },
    }) as Task
    tasks.value.push(created)
    newTitle.value = ''
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    addError.value = e.data?.title ?? 'Failed to add task'
  }
  finally {
    adding.value = false
  }
}

async function toggleDone(t: Task) {
  if (!canEdit.value) return
  const next: TaskStatus = t.status === 'done' ? 'open' : 'done'
  const prevStatus = t.status
  const prevCompletedAt = t.completed_at
  t.status = next
  t.completed_at = next === 'done' ? Math.floor(Date.now() / 1000) : null
  try {
    const updated = await ($fetch as any)(`/api/tasks/${t.id}`, {
      method: 'PATCH',
      body: { status: next },
    }) as Task
    Object.assign(t, updated)
  }
  catch (err: unknown) {
    t.status = prevStatus
    t.completed_at = prevCompletedAt
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to update task'
  }
}

async function deleteTaskQuick(id: string) {
  if (!canEdit.value) return
  const before = tasks.value
  tasks.value = tasks.value.filter(t => t.id !== id)
  try {
    await ($fetch as any)(`/api/tasks/${id}`, { method: 'DELETE' })
  }
  catch (err: unknown) {
    tasks.value = before
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to delete task'
  }
}

function openEdit(t: Task) {
  if (!canEdit.value) return
  editingTask.value = t
  editTitle.value = t.title
  editLaneId.value = effectiveLane(t)
  editNotes.value = t.notes
  editDueLocal.value = t.due_at ? unixToLocalInput(t.due_at) : ''
  editPriority.value = t.priority ?? ''
  editAssignee.value = t.assignee_email ?? ''
  editRemindLocal.value = t.remind_at ? unixToLocalInput(t.remind_at) : ''
  editContextUrl.value = t.context_url ?? ''
  editContextSummary.value = t.context_summary ?? ''
  // Auto-expand "Mehr Details" when the task already has anything set there,
  // so editing existing fields doesn't require a discovery click.
  showReminder.value = !!t.remind_at
  showAdvanced.value = !!(t.due_at || t.priority || t.assignee_email || t.context_summary)
  editError.value = ''
}

function closeEdit() {
  editingTask.value = null
  saving.value = false
}

async function saveEdit() {
  const t = editingTask.value
  if (!t || saving.value) return
  const title = editTitle.value.trim()
  if (!title) {
    editError.value = 'Title required'
    return
  }
  saving.value = true
  editError.value = ''
  const due = editDueLocal.value ? localInputToUnix(editDueLocal.value) : null
  const assignee = editAssignee.value.trim() || null
  const priority = editPriority.value === '' ? null : editPriority.value
  const remind = editRemindLocal.value ? localInputToUnix(editRemindLocal.value) : null
  const contextUrl = editContextUrl.value.trim() || null
  const contextSummary = editContextSummary.value.trim() || null
  try {
    const updated = await ($fetch as any)(`/api/tasks/${t.id}`, {
      method: 'PATCH',
      body: {
        title,
        notes: editNotes.value,
        due_at: due,
        assignee_email: assignee,
        priority,
        remind_at: remind,
        context_url: contextUrl,
        context_summary: contextSummary,
        // Lane move (server derives status from the lane's bucket). Only send
        // when it actually changed, so a plain field edit never moves the task.
        ...(editingTask.value && editLaneId.value && editLaneId.value !== effectiveLane(editingTask.value)
          ? { lane_id: editLaneId.value }
          : {}),
      },
    }) as Task
    const idx = tasks.value.findIndex(x => x.id === t.id)
    if (idx >= 0) tasks.value[idx] = updated
    closeEdit()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    editError.value = e.data?.title ?? 'Failed to save task'
  }
  finally {
    saving.value = false
  }
}

async function deleteFromSheet() {
  const t = editingTask.value
  if (!t) return
  if (!confirm(`Delete "${t.title}"?`)) return
  saving.value = true
  try {
    await ($fetch as any)(`/api/tasks/${t.id}`, { method: 'DELETE' })
    tasks.value = tasks.value.filter(x => x.id !== t.id)
    closeEdit()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    editError.value = e.data?.title ?? 'Failed to delete task'
  }
  finally {
    saving.value = false
  }
}

function openListSettings() {
  if (!detail.value) return
  settingsName.value = detail.value.name
  settingsDescription.value = detail.value.description ?? ''
  settingsLanes.value = (detail.value.lanes ?? []).map(l => ({ ...l }))
  settingsError.value = ''
  showListSettings.value = true
}

async function saveListSettings() {
  if (!detail.value || settingsSaving.value) return
  const name = settingsName.value.trim()
  if (!name) {
    settingsError.value = 'Name required'
    return
  }
  const lanes = settingsLanes.value
    .map(l => ({ id: l.id || undefined, name: l.name.trim(), status: l.status }))
    .filter(l => l.name.length > 0)
  if (lanes.length === 0) {
    settingsError.value = 'Mindestens eine Lane erforderlich'
    return
  }
  settingsSaving.value = true
  settingsError.value = ''
  try {
    await ($fetch as any)(`/api/teams/${teamId.value}`, {
      method: 'PATCH',
      body: {
        name,
        description: settingsDescription.value.trim() || null,
        lanes,
      },
    })
    await Promise.all([loadDetail(), loadTasks()])
    showListSettings.value = false
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    settingsError.value = e.data?.title ?? 'Failed to rename list'
  }
  finally {
    settingsSaving.value = false
  }
}

async function deleteList() {
  if (!detail.value || settingsDeleting.value) return
  const aliveCount = detail.value.task_count.open + detail.value.task_count.doing + detail.value.task_count.done
  const confirmMsg = aliveCount > 0
    ? `Delete "${detail.value.name}" and all ${aliveCount} task(s) in it? This can't be undone.`
    : `Delete "${detail.value.name}"? This can't be undone.`
  if (!confirm(confirmMsg)) return
  settingsDeleting.value = true
  settingsError.value = ''
  try {
    await ($fetch as any)(`/api/teams/${teamId.value}?force=true`, { method: 'DELETE' })
    await navigateTo('/teams')
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    settingsError.value = e.data?.title ?? 'Failed to delete list'
    settingsDeleting.value = false
  }
}

async function removeMember(email: string) {
  if (!confirm(`Remove ${email} from this team?`)) return
  try {
    await ($fetch as any)(`/api/teams/${teamId.value}/members/${encodeURIComponent(email)}`, { method: 'DELETE' })
    await loadDetail()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to remove member'
  }
}

async function toggleInvites() {
  showInvites.value = !showInvites.value
  if (showInvites.value) await loadInvites()
}

async function loadInvites() {
  invitesLoading.value = true
  invitesError.value = ''
  try {
    invites.value = await ($fetch as any)(`/api/teams/${teamId.value}/invites`) as InviteSummary[]
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    invitesError.value = e.data?.title ?? 'Failed to load invites'
    invites.value = []
  }
  finally {
    invitesLoading.value = false
  }
}

function openInviteModal() {
  createdUrl.value = ''
  createError.value = ''
  inviteMaxUses.value = 5
  inviteExpiresIn.value = '7d'
  inviteNote.value = ''
  copied.value = false
  showInviteModal.value = true
}

async function createInvite() {
  if (creating.value) return
  creating.value = true
  createError.value = ''
  try {
    const result = await ($fetch as any)(`/api/teams/${teamId.value}/invites`, {
      method: 'POST',
      body: {
        max_uses: inviteMaxUses.value,
        expires_in: inviteExpiresIn.value,
        note: inviteNote.value.trim() || undefined,
      },
    }) as { url: string }
    createdUrl.value = result.url
    await loadInvites()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    createError.value = e.data?.title ?? 'Failed to create invite'
  }
  finally {
    creating.value = false
  }
}

async function copyUrl() {
  if (!createdUrl.value) return
  try {
    await navigator.clipboard.writeText(createdUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch {
    copied.value = false
  }
}

async function revokeInvite(id: string) {
  if (!confirm('Revoke this invite? Anyone with the URL will no longer be able to join.')) return
  try {
    await ($fetch as any)(`/api/invites/${id}`, { method: 'DELETE' })
    await loadInvites()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    invitesError.value = e.data?.title ?? 'Failed to revoke invite'
  }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

function dueLabel(ts: number | null): string | null {
  if (!ts) return null
  const now = Math.floor(Date.now() / 1000)
  const diff = ts - now
  const absH = Math.abs(diff) / 3600
  if (absH < 24) {
    const d = new Date(ts * 1000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const days = Math.round(diff / 86400)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days < 7) return `In ${days}d`
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// <input type="datetime-local"> helpers. The input's value is a naive string
// in the user's local timezone; we round-trip via Date which applies local TZ.
function unixToLocalInput(ts: number): string {
  const d = new Date(ts * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToUnix(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000)
}

/** Bump the Remind input by a delta (seconds), starting from its current
 *  value if set, otherwise from now. Used by the +1h / +1d / +1w quick
 *  buttons in the edit sheet. */
function snoozeRemind(deltaSeconds: number): void {
  const baseUnix = editRemindLocal.value
    ? localInputToUnix(editRemindLocal.value)
    : Math.floor(Date.now() / 1000)
  editRemindLocal.value = unixToLocalInput(baseUnix + deltaSeconds)
}

/**
 * Set the Remind input to a named preset, modeled after iOS Reminders'
 * date popover (Heute Abend / Morgen früh / Nächste Woche). All anchors
 * are computed in the user's local timezone — Date constructor with
 * year/month/day/hour applies local TZ implicitly.
 */
type RemindPreset = 'plus-1h' | 'today-evening' | 'tomorrow-morning' | 'next-week'

function setRemindPreset(preset: RemindPreset): void {
  const now = new Date()
  let target: Date
  switch (preset) {
    case 'plus-1h':
      target = new Date(now.getTime() + 3600_000)
      break
    case 'today-evening':
      target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0)
      // If it's already past 18:00, push to tomorrow evening so the preset
      // never resolves into the past.
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1)
      }
      break
    case 'tomorrow-morning':
      target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0)
      break
    case 'next-week': {
      // Next Monday 09:00 (local). getDay() = 0..6 with 0=Sunday.
      const today = now.getDay()
      const daysUntilMonday = ((1 - today + 7) % 7) || 7
      target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday, 9, 0, 0)
      break
    }
  }
  editRemindLocal.value = unixToLocalInput(Math.floor(target.getTime() / 1000))
}

const isEditOpen = computed({
  get: () => editingTask.value !== null,
  set: (v: boolean) => { if (!v) closeEdit() },
})
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 pb-24">
    <!-- Top bar -->
    <header class="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur border-b border-zinc-900">
      <div class="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
        <UButton
          to="/teams"
          color="neutral"
          variant="ghost"
          icon="i-lucide-chevron-left"
          size="md"
          class="-ml-2 text-primary-500 hover:bg-transparent"
        >
          Lists
        </UButton>
        <div class="flex-1" />
        <UButton
          v-if="detail && isOwner"
          color="neutral"
          variant="ghost"
          icon="i-lucide-more-horizontal"
          size="md"
          :aria-label="`List settings for ${detail.name}`"
          class="text-primary-500 hover:bg-transparent"
          @click="openListSettings"
        />
      </div>
    </header>

    <div class="max-w-2xl mx-auto px-4 pt-4">
      <div v-if="loading" class="text-center text-zinc-500 mt-10">
        Loading…
      </div>

      <UAlert v-else-if="error && !detail" color="error" :title="error" />

      <template v-else-if="detail">
        <!-- List title -->
        <div class="mb-6 flex items-center gap-3">
          <div class="size-10 rounded-full bg-primary-500 flex items-center justify-center">
            <UIcon name="i-lucide-list-checks" class="size-5 text-white" />
          </div>
          <div class="min-w-0">
            <h1 class="text-3xl font-bold text-primary-500 leading-tight truncate">
              {{ detail.name }}
            </h1>
            <p v-if="detail.description" class="text-sm text-zinc-500 mt-0.5 truncate">
              {{ detail.description }}
            </p>
          </div>
        </div>

        <!-- Lane tabs — switch the visible board column. Horizontally
             scrollable so many lanes stay reachable on a phone. -->
        <div class="mb-4 -mx-4 px-4 overflow-x-auto">
          <div class="flex gap-1.5 min-w-min">
            <button
              v-for="l in lanes"
              :key="l.id"
              type="button"
              class="shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition whitespace-nowrap"
              :class="l.id === activeLaneId
                ? 'bg-primary-500 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'"
              @click="activeLaneId = l.id"
            >
              {{ l.name }}
              <span class="ml-1 text-xs opacity-80">{{ laneCounts[l.id] ?? 0 }}</span>
            </button>
          </div>
        </div>

        <!-- Add task into the active lane -->
        <form
          v-if="canEdit"
          class="mb-4 flex items-center gap-2"
          @submit.prevent="addTask"
        >
          <button
            type="submit"
            class="size-8 shrink-0 rounded-full flex items-center justify-center text-primary-500 hover:bg-primary-500/10 transition disabled:opacity-40"
            :disabled="!newTitle.trim() || adding"
            :title="adding ? 'Adding…' : 'Add task'"
          >
            <UIcon name="i-lucide-plus-circle" class="size-7" />
          </button>
          <input
            v-model="newTitle"
            type="text"
            maxlength="200"
            :placeholder="activeLaneName ? `New task in ${activeLaneName}` : 'New task'"
            class="flex-1 bg-transparent border-0 outline-none text-lg placeholder:text-zinc-600"
            :disabled="adding"
          >
        </form>
        <UAlert v-if="addError" color="error" :title="addError" class="mb-3" @close="addError = ''" />

        <!-- Active lane tasks -->
        <section class="mb-8">
          <div v-if="activeLaneTasks.length === 0" class="text-center py-10 text-zinc-500">
            <UIcon name="i-lucide-check-check" class="size-10 mx-auto mb-2 opacity-40" />
            <p>Keine Tasks in dieser Lane</p>
          </div>
          <ul class="divide-y divide-zinc-900">
            <li
              v-for="t in activeLaneTasks"
              :key="t.id"
              class="group flex items-center gap-3 py-3 min-h-[48px]"
            >
              <button
                type="button"
                class="size-6 shrink-0 rounded-full border-2 transition flex items-center justify-center"
                :class="t.status === 'done'
                  ? 'border-primary-500 bg-primary-500'
                  : 'border-zinc-600 hover:border-primary-500'"
                :disabled="!canEdit"
                :aria-label="t.status === 'done' ? `Mark ${t.title} as open` : `Mark ${t.title} as done`"
                @click.stop="toggleDone(t)"
              >
                <UIcon v-if="t.status === 'done'" name="i-lucide-check" class="size-4 text-white" />
              </button>

              <button
                type="button"
                class="min-w-0 flex-1 text-left cursor-pointer"
                :class="{ 'cursor-default': !canEdit }"
                :aria-label="`Edit ${t.title}`"
                @click="openEdit(t)"
              >
                <span class="block truncate text-base" :class="t.status === 'done' ? 'text-zinc-500 line-through' : ''">{{ t.title }}</span>
                <span v-if="t.status !== 'done' && (t.due_at || t.remind_at || t.assignee_email || t.priority)" class="flex items-center gap-2 mt-0.5">
                  <span
                    v-if="t.due_at"
                    class="text-xs"
                    :class="t.due_at < Date.now() / 1000 ? 'text-red-400' : 'text-primary-500'"
                  >
                    <UIcon name="i-lucide-calendar" class="size-3 inline -mt-0.5" />
                    {{ dueLabel(t.due_at) }}
                  </span>
                  <span
                    v-if="t.remind_at"
                    class="text-xs"
                    :class="t.reminder_count > 0 ? 'text-amber-400' : 'text-zinc-400'"
                    :title="t.reminder_count > 0
                      ? `Reminder ${t.reminder_count}/${t.reminder_max} sent`
                      : `Reminder pending`"
                  >
                    <UIcon name="i-lucide-bell" class="size-3 inline -mt-0.5" />
                    {{ dueLabel(t.remind_at) }}<span v-if="t.reminder_count > 0"> ({{ t.reminder_count }}/{{ t.reminder_max }})</span>
                  </span>
                  <span v-if="t.priority === 'high'" class="text-xs text-red-400">!!!</span>
                  <span v-else-if="t.priority === 'med'" class="text-xs text-amber-400">!!</span>
                  <span v-else-if="t.priority === 'low'" class="text-xs text-zinc-500">!</span>
                  <span v-if="t.assignee_email" class="text-xs text-zinc-500 truncate">
                    · {{ t.assignee_email }}
                  </span>
                </span>
              </button>

              <button
                v-if="canEdit"
                type="button"
                class="size-8 rounded-full text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center"
                :aria-label="`Delete ${t.title}`"
                @click.stop="deleteTaskQuick(t.id)"
              >
                <UIcon name="i-lucide-trash-2" class="size-4" />
              </button>
            </li>
          </ul>
        </section>

        <!-- Members -->
        <section class="mt-10 border-t border-zinc-900 pt-4">
          <button
            type="button"
            class="flex items-center gap-2 w-full py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200"
            @click="showMembers = !showMembers"
          >
            <UIcon :name="showMembers ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
            Members · {{ detail.members.length }}
          </button>
          <ul v-if="showMembers" class="divide-y divide-zinc-900 mt-1">
            <li
              v-for="m in detail.members"
              :key="m.email"
              class="flex items-center gap-3 py-3 min-h-[48px]"
            >
              <UIcon name="i-lucide-user" class="size-5 text-zinc-500 shrink-0" />
              <div class="min-w-0 flex-1 font-mono text-sm truncate">
                {{ m.email }}
              </div>
              <UBadge :color="m.role === 'owner' ? 'primary' : 'neutral'" variant="subtle" size="xs">
                {{ m.role }}
              </UBadge>
              <button
                v-if="isOwner && m.email !== user?.sub"
                type="button"
                class="size-8 rounded-full text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition flex items-center justify-center"
                :aria-label="`Remove ${m.email}`"
                @click="removeMember(m.email)"
              >
                <UIcon name="i-lucide-x" class="size-4" />
              </button>
            </li>
          </ul>
        </section>

        <!-- Invites -->
        <section v-if="canEdit" class="border-t border-zinc-900 pt-4">
          <div class="flex items-center justify-between">
            <button
              type="button"
              class="flex items-center gap-2 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200"
              @click="toggleInvites"
            >
              <UIcon :name="showInvites ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
              Invite links
            </button>
            <UButton color="primary" variant="ghost" icon="i-lucide-link" size="sm" @click="openInviteModal">
              New link
            </UButton>
          </div>
          <div v-if="showInvites" class="mt-1">
            <div v-if="invitesLoading" class="text-sm text-zinc-500 py-2">
              Loading…
            </div>
            <UAlert v-else-if="invitesError" color="error" :title="invitesError" />
            <div v-else-if="invites.length === 0" class="text-sm text-zinc-500 italic py-2">
              No active invites.
            </div>
            <ul v-else class="divide-y divide-zinc-900">
              <li
                v-for="inv in invites"
                :key="inv.id"
                class="flex items-center gap-3 py-3 min-h-[48px]"
              >
                <UIcon name="i-lucide-link" class="size-4 text-zinc-500 shrink-0" />
                <div class="min-w-0 flex-1 text-sm">
                  <div class="truncate">
                    By <span class="font-mono">{{ inv.created_by }}</span> · {{ inv.used_count }}/{{ inv.max_uses }}
                  </div>
                  <div class="text-xs text-zinc-500 truncate">
                    Expires {{ formatDate(inv.expires_at) }}
                    <span v-if="inv.note" class="italic">— "{{ inv.note }}"</span>
                  </div>
                </div>
                <button
                  type="button"
                  class="size-8 rounded-full text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition flex items-center justify-center"
                  :aria-label="`Revoke invite ${inv.id}`"
                  @click="revokeInvite(inv.id)"
                >
                  <UIcon name="i-lucide-x" class="size-4" />
                </button>
              </li>
            </ul>
          </div>
        </section>
      </template>
    </div>

    <!-- Task edit sheet — modeled after the iOS Reminders detail view:
         compact, sectioned, scrollable body, sticky save in the footer. -->
    <UModal v-model:open="isEditOpen" :dismissible="!saving">
      <template #content>
        <div v-if="editingTask" class="flex flex-col w-full max-h-[88vh] text-sm">
          <!-- Grab handle — bottom-sheet affordance, no redundant chrome. -->
          <div class="shrink-0 flex justify-center pt-2.5 pb-1">
            <div class="h-1 w-9 rounded-full bg-zinc-700" />
          </div>

          <!-- Scrollable body — content-first: the title and notes are the
               focus; reminders and metadata fold away into tidy rows. -->
          <div class="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
            <!-- Title — a 1-row auto-growing field so long titles wrap fully
                 into view instead of being clipped. Enter is suppressed so it
                 stays a single logical line. -->
            <UTextarea
              v-model="editTitle"
              :rows="1"
              autoresize
              maxlength="200"
              :disabled="saving"
              placeholder="Titel"
              variant="none"
              class="w-full"
              :ui="{ base: 'w-full text-xl font-semibold px-0 py-0 resize-none leading-snug' }"
              @keydown.enter.prevent
            />

            <!-- Notes — the primary editing area: grows with content but capped
                 (~35vh) so a long description never eats the whole sheet; it
                 scrolls inside once it hits the cap. -->
            <UTextarea
              v-model="editNotes"
              :rows="3"
              autoresize
              :maxrows="8"
              :disabled="saving"
              placeholder="Notizen …"
              variant="none"
              class="w-full"
              :ui="{ base: 'w-full px-0 py-0 text-[15px] leading-relaxed text-zinc-300 placeholder:text-zinc-600 resize-none max-h-[35vh] overflow-y-auto' }"
            />

            <!-- Lane — primary board action, full-width pill row -->
            <div v-if="lanes.length">
              <p class="text-xs font-medium text-zinc-500 mb-1.5">
                Lane
              </p>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="l in lanes"
                  :key="l.id"
                  type="button"
                  class="px-3 py-1.5 rounded-full text-sm font-medium transition disabled:opacity-50"
                  :class="editLaneId === l.id ? 'bg-primary-500 text-white' : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-800'"
                  :disabled="saving"
                  @click="editLaneId = l.id"
                >
                  {{ l.name }}
                </button>
              </div>
            </div>

            <!-- Foldaway rows — iOS-settings style: label left, summary right -->
            <div class="border-t border-zinc-800/70 divide-y divide-zinc-800/70">
              <!-- Erinnerung -->
              <div>
                <button
                  type="button"
                  class="w-full flex items-center gap-3 py-3 text-left"
                  @click="showReminder = !showReminder"
                >
                  <UIcon name="i-lucide-bell" class="size-4 text-zinc-500 shrink-0" />
                  <span class="flex-1 font-medium">Erinnerung</span>
                  <template v-if="!showReminder">
                    <span
                      v-if="reminderSummary"
                      class="text-sm"
                      :class="editingTask.reminder_count > 0 ? 'text-amber-400' : 'text-primary-400'"
                    >{{ reminderSummary }}</span>
                    <span v-else class="text-sm text-zinc-500">Keine</span>
                  </template>
                  <UIcon :name="showReminder ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-zinc-500 shrink-0" />
                </button>
                <div v-if="showReminder" class="pb-3 space-y-2.5">
                  <div class="grid grid-cols-2 gap-1.5">
                    <UButton size="sm" block variant="soft" color="neutral" :disabled="saving" @click="setRemindPreset('today-evening')">
                      Heute Abend
                    </UButton>
                    <UButton size="sm" block variant="soft" color="neutral" :disabled="saving" @click="setRemindPreset('tomorrow-morning')">
                      Morgen früh
                    </UButton>
                    <UButton size="sm" block variant="soft" color="neutral" :disabled="saving" @click="setRemindPreset('next-week')">
                      Nächste Woche
                    </UButton>
                    <UButton size="sm" block variant="soft" color="neutral" :disabled="saving" @click="setRemindPreset('plus-1h')">
                      +1h
                    </UButton>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <UInput v-model="editRemindLocal" type="datetime-local" :disabled="saving" size="sm" class="flex-1" />
                    <UButton
                      v-if="editRemindLocal"
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      icon="i-lucide-x"
                      :disabled="saving"
                      aria-label="Erinnerung entfernen"
                      @click="editRemindLocal = ''"
                    />
                  </div>
                  <p v-if="editRemindLocal" class="text-xs text-zinc-500">
                    Mail an {{ editAssignee || editingTask.owner_email }}<span v-if="editingTask.reminder_count > 0">. {{ editingTask.reminder_count }}/{{ editingTask.reminder_max }} bereits gesendet.</span>
                  </p>
                  <UInput v-model="editContextSummary" maxlength="1000" :disabled="saving" size="sm" placeholder="Mail-Vorschau (eine Zeile)" class="w-full" />
                  <UInput v-model="editContextUrl" maxlength="2048" :disabled="saving" size="sm" placeholder="Link zum Kontext (URL)" class="w-full" />
                </div>
              </div>

              <!-- Details -->
              <div>
                <button
                  type="button"
                  class="w-full flex items-center gap-3 py-3 text-left"
                  @click="showAdvanced = !showAdvanced"
                >
                  <UIcon name="i-lucide-sliders-horizontal" class="size-4 text-zinc-500 shrink-0" />
                  <span class="flex-1 font-medium">Details</span>
                  <template v-if="!showAdvanced">
                    <span v-if="detailsSummary" class="text-sm text-zinc-400 truncate max-w-40">{{ detailsSummary }}</span>
                    <span v-else class="text-sm text-zinc-500">—</span>
                  </template>
                  <UIcon :name="showAdvanced ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-zinc-500 shrink-0" />
                </button>
                <div v-if="showAdvanced" class="pb-3 space-y-3">
                  <div>
                    <p class="text-xs font-medium text-zinc-500 mb-1.5">
                      Priorität
                    </p>
                    <div class="grid grid-cols-4 gap-1.5">
                      <UButton
                        v-for="opt in (['', 'low', 'med', 'high'] as const)"
                        :key="opt || 'none'"
                        size="sm"
                        block
                        :variant="editPriority === opt ? 'solid' : 'soft'"
                        :color="editPriority === opt ? 'primary' : 'neutral'"
                        :disabled="saving"
                        @click="editPriority = opt"
                      >
                        {{ opt === '' ? 'Keine' : opt === 'med' ? 'Mittel' : opt === 'low' ? 'Niedrig' : 'Hoch' }}
                      </UButton>
                    </div>
                  </div>
                  <div>
                    <p class="text-xs font-medium text-zinc-500 mb-1.5">
                      Deadline <span class="text-zinc-600">(nur Anzeige)</span>
                    </p>
                    <div class="flex items-center gap-1.5">
                      <UInput v-model="editDueLocal" type="datetime-local" :disabled="saving" size="sm" class="flex-1" />
                      <UButton
                        v-if="editDueLocal"
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        icon="i-lucide-x"
                        :disabled="saving"
                        aria-label="Deadline entfernen"
                        @click="editDueLocal = ''"
                      />
                    </div>
                  </div>
                  <div>
                    <p class="text-xs font-medium text-zinc-500 mb-1.5">
                      Zuständig
                    </p>
                    <UInput v-model="editAssignee" type="email" :disabled="saving" size="sm" :placeholder="editingTask.owner_email" class="w-full" />
                  </div>
                </div>
              </div>
            </div>

            <UAlert v-if="editError" color="error" :title="editError" @close="editError = ''" />
          </div>

          <!-- Sticky footer — Save always reachable on mobile. -->
          <div class="flex items-center gap-2 px-4 py-2.5 border-t border-zinc-800 bg-zinc-900/30 shrink-0">
            <UButton color="primary" size="sm" :loading="saving" @click="saveEdit">
              Sichern
            </UButton>
            <UButton color="neutral" variant="ghost" size="sm" :disabled="saving" @click="closeEdit">
              Abbrechen
            </UButton>
            <div class="flex-1" />
            <UButton
              color="error"
              variant="ghost"
              size="sm"
              icon="i-lucide-trash-2"
              :disabled="saving"
              aria-label="Erinnerung löschen"
              @click="deleteFromSheet"
            />
          </div>
        </div>
      </template>
    </UModal>

    <!-- List settings sheet (owner only) -->
    <UModal v-model:open="showListSettings" :dismissible="!settingsSaving && !settingsDeleting">
      <template #content>
        <div class="p-6 space-y-4 max-w-md">
          <h3 class="text-lg font-semibold">
            Listen-Einstellungen
          </h3>

          <UFormField label="Name" required>
            <UInput v-model="settingsName" maxlength="120" size="lg" :disabled="settingsSaving || settingsDeleting" />
          </UFormField>

          <UFormField label="Beschreibung">
            <UTextarea
              v-model="settingsDescription"
              :rows="3"
              maxlength="500"
              :disabled="settingsSaving || settingsDeleting"
              placeholder="Optional"
            />
          </UFormField>

          <!-- Lane editor: name + status bucket, reorder, add/remove. -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">Lanes</span>
              <UButton size="xs" variant="ghost" color="neutral" :disabled="settingsSaving || settingsDeleting" @click="applyDevPreset">
                Dev-Workflow-Preset
              </UButton>
            </div>
            <p class="text-xs text-zinc-500">
              Spalten des Boards. Jede Lane gehört zu einem Status (Offen / In Arbeit / Fertig).
              Mindestens je eine „Offen"- und „Fertig"-Lane. Eine Lane zu entfernen schiebt ihre
              Tasks in die erste Lane desselben Status.
            </p>
            <div
              v-for="(l, idx) in settingsLanes"
              :key="idx"
              class="flex items-center gap-1.5"
            >
              <div class="flex flex-col">
                <button
                  type="button"
                  class="size-4 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 flex items-center justify-center"
                  :disabled="idx === 0 || settingsSaving"
                  aria-label="Lane nach oben"
                  @click="moveLane(idx, -1)"
                >
                  <UIcon name="i-lucide-chevron-up" class="size-4" />
                </button>
                <button
                  type="button"
                  class="size-4 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 flex items-center justify-center"
                  :disabled="idx === settingsLanes.length - 1 || settingsSaving"
                  aria-label="Lane nach unten"
                  @click="moveLane(idx, 1)"
                >
                  <UIcon name="i-lucide-chevron-down" class="size-4" />
                </button>
              </div>
              <UInput
                v-model="l.name"
                maxlength="40"
                size="sm"
                placeholder="Lane-Name"
                class="flex-1"
                :disabled="settingsSaving || settingsDeleting"
              />
              <USelect
                v-model="l.status"
                :items="laneStatusOptions"
                size="sm"
                class="w-28"
                :disabled="settingsSaving || settingsDeleting"
              />
              <button
                type="button"
                class="size-8 shrink-0 rounded-full text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition flex items-center justify-center"
                :disabled="settingsSaving"
                aria-label="Lane entfernen"
                @click="removeLane(idx)"
              >
                <UIcon name="i-lucide-x" class="size-4" />
              </button>
            </div>
            <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-plus" :disabled="settingsSaving || settingsDeleting" @click="addLane">
              Lane hinzufügen
            </UButton>
          </div>

          <UAlert v-if="settingsError" color="error" :title="settingsError" @close="settingsError = ''" />

          <div class="flex items-center gap-2 pt-2">
            <UButton color="primary" :loading="settingsSaving" :disabled="settingsDeleting" @click="saveListSettings">
              Speichern
            </UButton>
            <UButton color="neutral" variant="ghost" :disabled="settingsSaving || settingsDeleting" @click="showListSettings = false">
              Abbrechen
            </UButton>
          </div>

          <div class="border-t border-zinc-900 pt-4 mt-2">
            <p class="text-xs text-zinc-500 mb-2">
              Löscht die Liste und alle enthaltenen Tasks. Kann nicht rückgängig gemacht werden.
            </p>
            <UButton
              color="error"
              variant="soft"
              icon="i-lucide-trash-2"
              :loading="settingsDeleting"
              :disabled="settingsSaving"
              @click="deleteList"
            >
              Liste löschen
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showInviteModal" :dismissible="!creating">
      <template #content>
        <div class="p-6 space-y-4 max-w-md">
          <h3 class="text-lg font-semibold">
            Create invite link
          </h3>

          <div v-if="!createdUrl">
            <div class="space-y-3">
              <UFormField label="Max uses">
                <UInput v-model.number="inviteMaxUses" type="number" min="1" max="100" />
              </UFormField>
              <UFormField label="Expires in" help="e.g. 7d, 24h, 30m">
                <UInput v-model="inviteExpiresIn" placeholder="7d" />
              </UFormField>
              <UFormField label="Note (optional)" help="Context shown to the recipient.">
                <UInput v-model="inviteNote" maxlength="200" placeholder="Welcome to the team!" />
              </UFormField>
            </div>
            <UAlert v-if="createError" color="error" :title="createError" class="mt-3" @close="createError = ''" />
            <div class="flex gap-2 pt-4">
              <UButton color="primary" :loading="creating" @click="createInvite">
                Generate URL
              </UButton>
              <UButton color="neutral" variant="ghost" :disabled="creating" @click="showInviteModal = false">
                Cancel
              </UButton>
            </div>
          </div>

          <div v-else>
            <p class="text-sm text-zinc-400 mb-2">
              Share this URL. Anyone who opens it will be able to join the team (up to the uses limit before expiry).
            </p>
            <div class="p-3 rounded bg-zinc-800 font-mono text-xs break-all">
              {{ createdUrl }}
            </div>
            <div class="flex gap-2 pt-4">
              <UButton color="primary" icon="i-lucide-copy" @click="copyUrl">
                {{ copied ? 'Copied!' : 'Copy URL' }}
              </UButton>
              <UButton color="neutral" variant="ghost" @click="showInviteModal = false">
                Done
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
