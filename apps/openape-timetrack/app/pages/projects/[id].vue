<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser } = useOpenApeAuth()
const route = useRoute()
const projectId = String(route.params.id)

interface Project { id: string, company_id: string, name: string, role: string | null }
interface Entry {
  id: string
  entry_date: string
  duration_minutes: number
  started_at: number | null
  ended_at: number | null
  type: string
  billable: boolean
  is_break: boolean
  user_email: string
  description: string
}

const project = ref<Project | null>(null)
const entries = ref<Entry[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)

const form = ref({
  from: '',
  to: '',
  duration: '',
  type: 'code',
  date: new Date().toISOString().slice(0, 10),
  description: '',
  billable: true,
  isBreak: false,
})
const TYPES = ['code', 'research', 'planning', 'review', 'admin', 'meeting']

function fmt(min: number) {
  const h = Math.floor(min / 60); const m = min % 60
  return h > 0 ? `${h}h${m ? `${m}m` : ''}` : `${m}m`
}

function hhmm(epoch: number | null): string {
  if (!epoch) return '—'
  return new Date(epoch * 1000).toISOString().slice(11, 16)
}

function toEpoch(date: string, t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const base = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return null
  return Math.floor(base.getTime() / 1000) + Number(m[1]) * 3600 + Number(m[2]) * 60
}

onMounted(async () => {
  await fetchUser()
  if (!user.value) { await navigateTo('/login'); return }
  await load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    project.value = await ($fetch as any)(`/api/projects/${projectId}`) as Project
    entries.value = await ($fetch as any)('/api/entries', { query: { project: projectId } }) as Entry[]
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Failed to load project'
  }
  finally {
    loading.value = false
  }
}

async function logTime() {
  if (saving.value) return
  const hasRange = form.value.from.trim() && form.value.to.trim()
  if (!hasRange && !form.value.duration.trim()) {
    error.value = 'Von/Bis oder Dauer angeben'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const body: Record<string, unknown> = {
      project_id: projectId,
      type: form.value.type,
      date: form.value.date,
      description: form.value.description,
      billable: form.value.billable,
      is_break: form.value.isBreak,
      created_via: 'web',
    }
    if (hasRange) {
      const s = toEpoch(form.value.date, form.value.from)
      const e = toEpoch(form.value.date, form.value.to)
      if (s == null || e == null) { error.value = 'Von/Bis als HH:MM'; saving.value = false; return }
      body.started_at = s
      body.ended_at = e
    }
    else {
      body.duration = form.value.duration
    }
    await ($fetch as any)('/api/entries', { method: 'POST', body })
    form.value.from = ''
    form.value.to = ''
    form.value.duration = ''
    form.value.description = ''
    form.value.isBreak = false
    await load()
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Log failed'
  }
  finally {
    saving.value = false
  }
}

async function remove(id: string) {
  try {
    await ($fetch as any)(`/api/entries/${id}`, { method: 'DELETE' })
    await load()
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Delete failed'
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 pb-24">
    <div class="max-w-2xl mx-auto px-4 pt-6">
      <NuxtLink
        v-if="project"
        :to="`/companies/${project.company_id}`"
        class="text-sm text-zinc-500 hover:text-primary-500"
      >
        ← Company
      </NuxtLink>

      <div v-if="loading" class="text-center text-zinc-500 mt-10">
        Loading…
      </div>
      <UAlert v-else-if="error && !project" color="error" :title="error" class="mt-4" />
      <template v-else-if="project">
        <h1 class="text-2xl font-bold mt-2 mb-6">
          {{ project.name }}
        </h1>

        <form class="space-y-3 mb-8 rounded-lg bg-zinc-900/60 p-4" @submit.prevent="logTime">
          <div class="flex gap-2">
            <UInput v-model="form.from" type="time" size="lg" class="flex-1" placeholder="Von" />
            <UInput v-model="form.to" type="time" size="lg" class="flex-1" placeholder="Bis" />
            <USelect v-model="form.type" :items="TYPES" size="lg" class="w-36" />
          </div>
          <div class="flex gap-2 items-center">
            <UInput v-model="form.duration" placeholder="oder Dauer: 45 / 1h30m" size="lg" class="flex-1" />
            <UInput v-model="form.date" type="date" size="lg" class="flex-1" />
          </div>
          <div class="flex gap-4 items-center text-sm text-zinc-400">
            <label class="flex items-center gap-2">
              <USwitch v-model="form.isBreak" /> Pause
            </label>
            <label class="flex items-center gap-2" :class="form.isBreak ? 'opacity-40' : ''">
              <USwitch v-model="form.billable" :disabled="form.isBreak" /> billable
            </label>
          </div>
          <UInput v-model="form.description" placeholder="What did you work on?" size="lg" class="w-full" />
          <UButton
            type="submit" color="primary" block size="lg" icon="i-lucide-clock"
            :loading="saving"
            :disabled="!((form.from.trim() && form.to.trim()) || form.duration.trim())"
          >
            Log time
          </UButton>
          <UAlert v-if="error" color="error" :title="error" />
        </form>

        <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          Entries
        </h2>
        <div v-if="entries.length === 0" class="text-center py-8 text-zinc-500">
          No entries yet.
        </div>
        <ul v-else class="divide-y divide-zinc-900">
          <li v-for="e in entries" :key="e.id" class="flex items-center gap-3 py-3">
            <div class="text-sm tabular-nums text-zinc-400 w-24 shrink-0">
              {{ e.entry_date }}
            </div>
            <div class="w-16 shrink-0">
              <div class="font-semibold tabular-nums">
                {{ fmt(e.duration_minutes) }}
              </div>
              <div class="text-[10px] tabular-nums text-zinc-500">
                {{ hhmm(e.started_at) }}–{{ hhmm(e.ended_at) }}
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                {{ e.description || '—' }}
              </div>
              <div class="text-xs text-zinc-500">
                <span v-if="e.is_break" class="text-amber-500 font-medium">Pause</span>
                <template v-else>{{ e.type }}<span v-if="e.billable"> · billable</span></template>
                · {{ e.user_email }}
              </div>
            </div>
            <UButton
              color="error" variant="ghost" size="xs" icon="i-lucide-trash-2"
              @click="remove(e.id)"
            />
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>
