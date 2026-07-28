<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser, logout } = useOpenApeAuth()

interface Entry {
  id: string
  entry_date: string
  duration_minutes: number
  started_at: number | null
  ended_at: number | null
  type: string
  billable: boolean
  is_break: boolean
  description: string
  project_id: string
  project_name: string
  company_id: string
  company_name: string
  overlap: boolean
}
interface Proj { id: string, name: string, company_id: string, company_name: string }

const month = ref(new Date().toISOString().slice(0, 7)) // YYYY-MM
const entries = ref<Entry[]>([])
const projectsList = ref<Proj[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const selectedDay = ref(new Date().toISOString().slice(0, 10))

// Filter (also pre-fills the add form). 'all' = no filter. We use a real
// sentinel value, not '' — Nuxt UI USelect cannot re-select an empty-string
// option, so '' could never be reset back to "Alle".
const ALL = 'all'
const filterCompany = ref(ALL)
const filterProject = ref(ALL)

const form = ref({
  projectId: '',
  from: '',
  to: '',
  duration: '',
  type: 'code',
  description: '',
  billable: true,
  isBreak: false,
})
const TYPES = ['code', 'research', 'planning', 'review', 'admin', 'meeting']

function fmt(min: number) {
  const h = Math.floor(min / 60); const m = min % 60
  return h > 0 ? `${h}h${m ? `${m}m` : ''}` : `${m}m`
}
function hhmm(e: number | null) { return e ? new Date(e * 1000).toISOString().slice(11, 16) : '—' }
function toEpoch(date: string, t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const base = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(base.getTime()) ? null : Math.floor(base.getTime() / 1000) + Number(m[1]) * 3600 + Number(m[2]) * 60
}

function monthBounds(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const first = `${ym}-01`
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
  return { first, last, y: y!, m: m! }
}

// Calendar grid: weeks (Mon-first) covering the month.
const grid = computed(() => {
  const { y, m } = monthBounds(month.value)
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7 // Mon=0
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: Array<{ date: string | null }> = []
  for (let i = 0; i < firstDow; i++) cells.push({ date: null })
  for (let d = 1; d <= days; d++) cells.push({ date: `${month.value}-${String(d).padStart(2, '0')}` })
  while (cells.length % 7 !== 0) cells.push({ date: null })
  const weeks: Array<Array<{ date: string | null }>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
})

// Distinct companies/projects for the filter dropdowns (from loggable
// projects ∪ projects that appear in the month's own entries).
const companyOptions = computed(() => {
  const m = new Map<string, string>()
  for (const p of projectsList.value) m.set(p.company_id, p.company_name)
  for (const e of entries.value) m.set(e.company_id, e.company_name)
  return [{ label: 'Alle Firmen', value: ALL }, ...[...m].map(([value, label]) => ({ label, value }))]
})
const projectOptions = computed(() => {
  const m = new Map<string, string>()
  for (const p of projectsList.value) {
    if (filterCompany.value === ALL || p.company_id === filterCompany.value) m.set(p.id, p.name)
  }
  for (const e of entries.value) {
    if (filterCompany.value === ALL || e.company_id === filterCompany.value) m.set(e.project_id, e.project_name)
  }
  return [{ label: 'Alle Projekte', value: ALL }, ...[...m].map(([value, label]) => ({ label, value }))]
})

const visibleEntries = computed(() => entries.value.filter(e =>
  (filterCompany.value === ALL || e.company_id === filterCompany.value)
  && (filterProject.value === ALL || e.project_id === filterProject.value),
))

const byDay = computed(() => {
  const map = new Map<string, { work: number, brk: number, overlap: boolean }>()
  for (const e of visibleEntries.value) {
    const d = map.get(e.entry_date) ?? { work: 0, brk: 0, overlap: false }
    if (e.is_break) d.brk += e.duration_minutes
    else d.work += e.duration_minutes
    if (e.overlap) d.overlap = true
    map.set(e.entry_date, d)
  }
  return map
})
const dayEntries = computed(() => visibleEntries.value.filter(e => e.entry_date === selectedDay.value))
const monthWork = computed(() => visibleEntries.value.filter(e => !e.is_break).reduce((s, e) => s + e.duration_minutes, 0))
const monthBillable = computed(() => visibleEntries.value.filter(e => !e.is_break && e.billable).reduce((s, e) => s + e.duration_minutes, 0))
const overlapCount = computed(() => visibleEntries.value.filter(e => e.overlap).length)

// Filter selection pre-fills the add form's project. With "Alle" selected
// no project is pre-filled — logging is only possible after explicitly
// choosing a project (submit stays disabled until then).
watch(filterCompany, () => {
  if (filterProject.value !== ALL && filterCompany.value !== ALL
    && !projectsList.value.some(p => p.id === filterProject.value && p.company_id === filterCompany.value)) {
    filterProject.value = ALL
  }
})
watch([filterCompany, filterProject], () => {
  form.value.projectId = filterProject.value !== ALL ? filterProject.value : ''
})

onMounted(async () => {
  await fetchUser()
  if (!user.value) { await navigateTo('/login'); return }
  projectsList.value = await ($fetch as any)('/api/me/projects') as Proj[]
  // No auto-prefill: default filter is "Alle" → user must pick a project
  // before logging is possible.
  await load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { first, last } = monthBounds(month.value)
    entries.value = await ($fetch as any)('/api/me/entries', { query: { from: first, to: last } }) as Entry[]
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Laden fehlgeschlagen'
  }
  finally {
    loading.value = false
  }
}

function shiftMonth(delta: number) {
  const { y, m } = monthBounds(month.value)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  month.value = d.toISOString().slice(0, 7)
  load()
}

async function logTime() {
  if (saving.value) return
  if (!form.value.projectId) { error.value = 'Projekt wählen'; return }
  const hasRange = form.value.from.trim() && form.value.to.trim()
  if (!hasRange && !form.value.duration.trim()) { error.value = 'Von/Bis oder Dauer'; return }
  saving.value = true
  error.value = ''
  try {
    const body: Record<string, unknown> = {
      project_id: form.value.projectId,
      type: form.value.type,
      date: selectedDay.value,
      description: form.value.description,
      billable: form.value.billable,
      is_break: form.value.isBreak,
      created_via: 'web',
    }
    if (hasRange) {
      const s = toEpoch(selectedDay.value, form.value.from)
      const e = toEpoch(selectedDay.value, form.value.to)
      if (s == null || e == null) { error.value = 'Von/Bis als HH:MM'; saving.value = false; return }
      body.started_at = s
      body.ended_at = e
    }
    else { body.duration = form.value.duration }
    await ($fetch as any)('/api/entries', { method: 'POST', body })
    form.value.from = ''; form.value.to = ''; form.value.duration = ''
    form.value.description = ''; form.value.isBreak = false
    await load()
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Log fehlgeschlagen'
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
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Löschen fehlgeschlagen'
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 pb-24">
    <div class="max-w-2xl mx-auto px-4 pt-6">
      <div class="flex items-center justify-between mb-4">
        <div class="min-w-0">
          <h1 class="text-2xl font-bold">
            Meine Stunden
          </h1>
          <p v-if="user" class="text-sm text-zinc-500 truncate">
            {{ user.sub }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton to="/companies" color="neutral" variant="soft" size="sm" icon="i-lucide-building-2">
            Firmen
          </UButton>
          <UButton color="neutral" variant="ghost" size="sm" @click="logout">
            Logout
          </UButton>
        </div>
      </div>

      <!-- Filter (Firma / Projekt) — also pre-fills the add form -->
      <div class="flex gap-2 mb-3">
        <USelect
          v-model="filterCompany"
          :items="companyOptions"
          size="lg"
          class="flex-1"
        />
        <USelect
          v-model="filterProject"
          :items="projectOptions"
          size="lg"
          class="flex-1"
        />
      </div>

      <!-- Month pagination -->
      <div class="flex items-center justify-between mb-3">
        <UButton color="neutral" variant="soft" icon="i-lucide-chevron-left" @click="shiftMonth(-1)" />
        <div class="text-center">
          <div class="font-semibold tabular-nums">
            {{ month }}
          </div>
          <div class="text-xs text-zinc-500">
            {{ fmt(monthWork) }} · billable {{ fmt(monthBillable) }}
            <span v-if="overlapCount" class="text-amber-500"> · {{ overlapCount }} Überschneidung(en)</span>
          </div>
        </div>
        <UButton color="neutral" variant="soft" icon="i-lucide-chevron-right" @click="shiftMonth(1)" />
      </div>

      <UAlert v-if="error" color="error" :title="error" class="mb-3" @close="error = ''" />
      <div v-if="loading" class="text-center text-zinc-500 py-6">
        Laden…
      </div>

      <!-- Calendar grid -->
      <div v-else class="grid grid-cols-7 gap-1 mb-6 text-center select-none">
        <div v-for="d in ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']" :key="d" class="text-[10px] text-zinc-600 pb-1">
          {{ d }}
        </div>
        <template v-for="(week, wi) in grid" :key="wi">
          <button
            v-for="(cell, ci) in week"
            :key="`${wi}-${ci}`"
            type="button"
            :disabled="!cell.date"
            class="aspect-square rounded-md text-xs flex flex-col items-center justify-center transition"
            :class="[
              cell.date ? 'hover:bg-zinc-800' : 'opacity-0 pointer-events-none',
              cell.date === selectedDay ? 'bg-primary-600 text-white' : 'bg-zinc-900/60',
            ]"
            @click="cell.date && (selectedDay = cell.date)"
          >
            <span v-if="cell.date" class="tabular-nums">{{ Number(cell.date.slice(-2)) }}</span>
            <span
              v-if="cell.date && byDay.get(cell.date)"
              class="text-[9px] tabular-nums"
              :class="cell.date === selectedDay ? 'text-white/80' : 'text-primary-400'"
            >{{ fmt(byDay.get(cell.date)!.work) }}</span>
            <span
              v-if="cell.date && byDay.get(cell.date)?.overlap"
              class="w-1 h-1 rounded-full bg-amber-500 mt-0.5"
            />
          </button>
        </template>
      </div>

      <!-- Add entry for selected day -->
      <form class="space-y-3 mb-6 rounded-lg bg-zinc-900/60 p-4" @submit.prevent="logTime">
        <div class="text-sm font-medium text-zinc-300">
          Eintrag für {{ selectedDay }}
        </div>
        <USelect
          v-model="form.projectId"
          :items="projectsList.map(p => ({ label: `${p.company_name} / ${p.name}`, value: p.id }))"
          placeholder="Projekt wählen"
          size="lg"
          class="w-full"
        />
        <div class="flex gap-2">
          <UInput v-model="form.from" type="time" size="lg" class="flex-1" placeholder="Von" />
          <UInput v-model="form.to" type="time" size="lg" class="flex-1" placeholder="Bis" />
          <USelect v-model="form.type" :items="TYPES" size="lg" class="w-32" />
        </div>
        <UInput v-model="form.duration" placeholder="oder Dauer: 45 / 1h30m" size="lg" class="w-full" />
        <UInput v-model="form.description" placeholder="Beschreibung" size="lg" class="w-full" />
        <div class="flex gap-4 items-center text-sm text-zinc-400">
          <label class="flex items-center gap-2"><USwitch v-model="form.isBreak" /> Pause</label>
          <label class="flex items-center gap-2" :class="form.isBreak ? 'opacity-40' : ''">
            <USwitch v-model="form.billable" :disabled="form.isBreak" /> billable
          </label>
        </div>
        <p v-if="!form.projectId" class="text-xs text-zinc-500">
          Projekt wählen (Filter „Alle" → kein Eintragen möglich).
        </p>
        <UButton
          type="submit" color="primary" block size="lg" icon="i-lucide-clock"
          :loading="saving" :disabled="!form.projectId"
        >
          Zeit buchen
        </UButton>
      </form>

      <!-- Selected day entries -->
      <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-2">
        {{ selectedDay }} — {{ dayEntries.length }} Eintrag(e)
      </h2>
      <div v-if="dayEntries.length === 0" class="text-center py-6 text-zinc-500">
        Keine Einträge an diesem Tag.
      </div>
      <ul v-else class="divide-y divide-zinc-900">
        <li v-for="e in dayEntries" :key="e.id" class="flex items-center gap-3 py-3">
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
              {{ e.company_name }} / {{ e.project_name }}
            </div>
            <div class="truncate text-xs text-zinc-500">
              <span v-if="e.is_break" class="text-amber-500 font-medium">Pause</span>
              <template v-else>{{ e.type }}<span v-if="e.billable"> · billable</span></template>
              <span v-if="e.description"> · {{ e.description }}</span>
            </div>
            <div v-if="e.overlap" class="text-xs text-amber-500 mt-0.5">
              ⚠ überschneidet sich mit einem anderen Eintrag
            </div>
          </div>
          <UButton color="error" variant="ghost" size="xs" icon="i-lucide-trash-2" @click="remove(e.id)" />
        </li>
      </ul>
    </div>
  </div>
</template>
