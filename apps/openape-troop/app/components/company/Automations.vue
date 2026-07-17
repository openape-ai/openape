<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

// Automations panel: proactive triggers. Each row is a schedule (cron daily /
// periodic, or a one-shot timer) whose `prompt` the Operator runs when due —
// the answer lands in the cockpit chat and fires a Web-Push.
const props = defineProps<{ orgId: string }>()

interface Trigger {
  id: string
  kind: string
  prompt: string
  atHour: number | null
  everyMinutes: number | null
  fireAt: number | null
  cronExpr: string | null
  enabled: boolean
  createdBy: string
  lastRunAt: number | null
}

const items = ref<Trigger[]>([])
const loading = ref(true)
const busy = reactive<Record<string, boolean>>({})

async function load() {
  loading.value = true
  items.value = await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/schedules`)
  loading.value = false
}

const fmt = (ms: number) => new Date(ms).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })
function scheduleLabel(t: Trigger): string {
  if (t.cronExpr) return `cron · ${t.cronExpr}`
  if (t.fireAt != null) return `einmalig · ${fmt(t.fireAt)}`
  if (t.atHour != null) return `täglich · ${String(t.atHour).padStart(2, '0')}:00 Uhr`
  if (t.everyMinutes != null) return `alle ${t.everyMinutes} min`
  return '—'
}

type Mode = 'daily' | 'periodic' | 'timer' | 'cron'
const modeOptions = [
  { value: 'daily', label: 'Täglich zur Uhrzeit' },
  { value: 'periodic', label: 'Alle N Minuten' },
  { value: 'timer', label: 'Einmalig zum Zeitpunkt' },
  { value: 'cron', label: 'Cron-Ausdruck' },
]

const showForm = ref(false)
const editingId = ref('')
const saving = ref(false)
const formError = ref('')
const form = reactive({ kind: '', prompt: '', mode: 'daily' as Mode, atHour: 7, everyMinutes: 60, fireAtLocal: '', cronExpr: '' })

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function openAdd() {
  editingId.value = ''
  Object.assign(form, { kind: '', prompt: '', mode: 'daily', atHour: 7, everyMinutes: 60, fireAtLocal: '', cronExpr: '' })
  formError.value = ''
  showForm.value = true
}
function openEdit(t: Trigger) {
  editingId.value = t.id
  const mode: Mode = t.cronExpr ? 'cron' : t.fireAt != null ? 'timer' : t.everyMinutes != null ? 'periodic' : 'daily'
  Object.assign(form, {
    kind: t.kind,
    prompt: t.prompt,
    mode,
    atHour: t.atHour ?? 7,
    everyMinutes: t.everyMinutes ?? 60,
    fireAtLocal: t.fireAt != null ? toLocalInput(t.fireAt) : '',
    cronExpr: t.cronExpr ?? '',
  })
  formError.value = ''
  showForm.value = true
}

async function submit() {
  if (!form.kind.trim()) { formError.value = 'Name nötig.'; return }
  if (!form.prompt.trim()) { formError.value = 'Anweisung nötig.'; return }
  const body: Record<string, unknown> = { kind: form.kind.trim(), prompt: form.prompt.trim(), atHour: null, everyMinutes: null, fireAt: null, cronExpr: null }
  if (form.mode === 'daily') {
    body.atHour = Math.max(0, Math.min(23, Math.floor(form.atHour)))
  }
  else if (form.mode === 'periodic') {
    body.everyMinutes = Math.max(1, Math.floor(form.everyMinutes))
  }
  else if (form.mode === 'cron') {
    if (!form.cronExpr.trim()) { formError.value = 'Cron-Ausdruck nötig.'; return }
    body.cronExpr = form.cronExpr.trim()
  }
  else {
    const ms = form.fireAtLocal ? new Date(form.fireAtLocal).getTime() : Number.NaN
    if (!Number.isFinite(ms)) { formError.value = 'Zeitpunkt nötig.'; return }
    body.fireAt = ms
  }
  saving.value = true
  formError.value = ''
  try {
    if (editingId.value) await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/schedules/${editingId.value}`, { method: 'PATCH', body })
    else await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/schedules`, { method: 'POST', body })
    showForm.value = false
    await load()
  }
  catch (err: any) { formError.value = err?.data?.statusMessage || 'Speichern fehlgeschlagen.' }
  finally { saving.value = false }
}
async function toggleEnabled(t: Trigger) {
  busy[t.id] = true
  try {
    await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/schedules/${t.id}`, { method: 'PATCH', body: { enabled: !t.enabled } })
    await load()
  }
  finally { busy[t.id] = false }
}
async function remove(t: Trigger) {
  busy[t.id] = true
  try {
    await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/schedules/${t.id}`, { method: 'DELETE' })
    await load()
  }
  finally { busy[t.id] = false }
}

const timerPreview = computed(() => {
  if (form.mode !== 'timer' || !form.fireAtLocal) return ''
  const ms = new Date(form.fireAtLocal).getTime()
  return Number.isFinite(ms) ? fmt(ms) : ''
})

watch(() => props.orgId, load, { immediate: true })
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <p class="text-sm text-zinc-500">
        Proaktive Trigger — der Operator meldet sich von sich aus (Briefing, Erinnerung) in den Chat + aufs Handy.
      </p>
      <UButton color="primary" icon="i-lucide-plus" @click="openAdd">
        Trigger
      </UButton>
    </div>

    <div v-if="loading" class="text-zinc-500 py-10 text-center">
      Lädt …
    </div>
    <div v-else-if="!items.length" class="text-zinc-600 italic py-10 text-center">
      Noch kein Trigger. Leg den ersten an — z. B. „morning-digest: täglich 7:00 Uhr das Briefing".
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="t in items"
        :key="t.id"
        class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 cursor-pointer hover:border-zinc-700"
        @click="openEdit(t)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium truncate">{{ t.kind || '(ohne Name)' }}</span>
              <UBadge color="neutral" variant="subtle" size="xs" icon="i-lucide-clock">
                {{ scheduleLabel(t) }}
              </UBadge>
              <UBadge v-if="t.createdBy === 'operator'" color="info" variant="subtle" size="xs" icon="i-lucide-bot">
                vom Operator
              </UBadge>
              <UBadge v-if="!t.enabled" color="warning" variant="subtle" size="xs">
                pausiert
              </UBadge>
            </div>
            <p class="text-xs text-zinc-500 mt-1 line-clamp-2">
              {{ t.prompt }}
            </p>
            <p class="text-[11px] text-zinc-600 mt-1">
              zuletzt gefeuert: {{ t.lastRunAt ? fmt(t.lastRunAt) : 'noch nie' }}
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0" @click.stop>
            <USwitch :model-value="t.enabled" :disabled="busy[t.id]" @update:model-value="toggleEnabled(t)" />
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :loading="busy[t.id]" @click="remove(t)" />
          </div>
        </div>
      </div>
    </div>

    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ editingId ? 'Trigger bearbeiten' : 'Trigger hinzufügen' }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showForm = false" />
          </div>
          <UFormField label="Name" description="Kurzer Bezeichner.">
            <UInput v-model="form.kind" placeholder="morning-digest" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Zeitplan">
            <div class="space-y-3">
              <USelect v-model="form.mode" :items="modeOptions" value-key="value" class="w-full" />
              <div v-if="form.mode === 'daily'" class="flex items-center gap-2">
                <UInput v-model.number="form.atHour" type="number" :min="0" :max="23" class="w-24" />
                <span class="text-sm text-zinc-500">Uhr (Wiener Zeit, täglich)</span>
              </div>
              <div v-else-if="form.mode === 'periodic'" class="flex items-center gap-2">
                <UInput v-model.number="form.everyMinutes" type="number" :min="1" class="w-24" />
                <span class="text-sm text-zinc-500">Minuten Intervall</span>
              </div>
              <div v-else-if="form.mode === 'timer'">
                <UInput v-model="form.fireAtLocal" type="datetime-local" class="w-full" :ui="{ base: 'w-full' }" />
                <p v-if="timerPreview" class="text-xs text-zinc-500 mt-1">
                  feuert einmalig am {{ timerPreview }}
                </p>
              </div>
              <div v-else>
                <UInput v-model="form.cronExpr" placeholder="0 7 * * 1-5" class="w-full font-mono" :ui="{ base: 'w-full' }" />
                <p class="text-xs text-zinc-500 mt-1">
                  5-Feld-Cron (Wiener Zeit): Minute Stunde Tag Monat Wochentag. Beispiel: <code>0 7 * * 1-5</code> = werktags 7:00.
                </p>
              </div>
            </div>
          </UFormField>
          <UFormField label="Anweisung (prompt)" description="Was der Operator tut, wenn der Trigger fällig ist.">
            <UTextarea v-model="form.prompt" :rows="8" placeholder="Erstelle das Morgen-Briefing: neue Mails, heutige Termine, offene Ziele — 3–5 Sätze." class="w-full text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UAlert v-if="formError" color="error" variant="subtle" :title="formError" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showForm = false">
              Abbrechen
            </UButton>
            <UButton color="primary" :loading="saving" @click="submit">
              {{ editingId ? 'Speichern' : 'Hinzufügen' }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <div class="mt-10 border-t border-zinc-800 pt-8">
      <CompanyWebhooks :org-id="props.orgId" />
    </div>
  </div>
</template>
