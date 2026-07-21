<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

// Skill library — owner-level, reusable procedures (e.g. tool-skills like o365-cli/
// gmail-cli) assignable to agents across ALL companies. Distinct from a company's
// own Skills tab (org-scoped).
useSeoMeta({ title: () => 'Skill-Bibliothek' })

const { fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface Skill { id: string, name: string, description: string, prompt: string, assignedTo: string[], updatedAt: number }
interface Agent { id: string, label: string, role: string, orgId: string, orgName: string }

const items = ref<Skill[]>([])
const agents = ref<Agent[]>([])
const loading = ref(true)
const error = ref('')
const busy = reactive<Record<string, boolean>>({})

// Assignment targets: the operators of all companies ('ceo') plus every agent,
// grouped by company for the editor.
const agentsByOrg = computed(() => {
  const groups = new Map<string, Agent[]>()
  for (const a of agents.value) {
    if (a.role === 'ceo') continue
    if (!groups.has(a.orgName)) groups.set(a.orgName, [])
    groups.get(a.orgName)!.push(a)
  }
  return Array.from(groups.entries(), ([orgName, list]) => ({ orgName, list }))
})
const labelFor = (t: string) => t === 'ceo' ? 'Operator (alle Firmen)' : agents.value.find(a => a.id === t)?.label ?? t

async function load() {
  loading.value = true
  error.value = ''
  try {
    ;[items.value, agents.value] = await Promise.all([
      ($fetch as any)('/api/cockpit/skills'),
      ($fetch as any)('/api/cockpit/agents'),
    ])
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || 'Konnte die Bibliothek nicht laden.'
  }
  finally { loading.value = false }
}

const showForm = ref(false)
const editingId = ref('')
const saving = ref(false)
const formError = ref('')
const form = reactive({ name: '', description: '', prompt: '', assignedTo: [] as string[] })

function openAdd() {
  editingId.value = ''
  Object.assign(form, { name: '', description: '', prompt: '', assignedTo: [] })
  formError.value = ''
  showForm.value = true
}
function openEdit(s: Skill) {
  editingId.value = s.id
  Object.assign(form, { name: s.name, description: s.description, prompt: s.prompt, assignedTo: [...s.assignedTo] })
  formError.value = ''
  showForm.value = true
}
function toggleTarget(value: string) {
  const i = form.assignedTo.indexOf(value)
  if (i === -1) form.assignedTo.push(value)
  else form.assignedTo.splice(i, 1)
}

async function submit() {
  if (!form.name.trim()) { formError.value = 'Name nötig.'; return }
  saving.value = true
  formError.value = ''
  const body = { name: form.name.trim(), description: form.description.trim(), prompt: form.prompt, assignedTo: form.assignedTo }
  try {
    if (editingId.value) await ($fetch as any)(`/api/cockpit/skills/${editingId.value}`, { method: 'PATCH', body })
    else await ($fetch as any)('/api/cockpit/skills', { method: 'POST', body })
    showForm.value = false
    await load()
  }
  catch (err: any) { formError.value = err?.data?.statusMessage || 'Speichern fehlgeschlagen.' }
  finally { saving.value = false }
}
async function remove(s: Skill) {
  busy[s.id] = true
  try {
    await ($fetch as any)(`/api/cockpit/skills/${s.id}`, { method: 'DELETE' })
    await load()
  }
  finally { busy[s.id] = false }
}

await load()
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="app-header">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-2xl shrink-0" aria-hidden="true">🦍</span>
        <ViewToggle active="skills" />
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <UButton color="primary" size="sm" icon="i-lucide-plus" @click="openAdd">
          <span class="hidden sm:inline">Skill</span>
        </UButton>
        <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-log-out" @click="logout" />
      </div>
    </header>

    <main class="max-w-4xl mx-auto px-4 sm:px-8 py-8">
      <h2 class="text-2xl font-bold mb-1">
        Skill-Bibliothek
      </h2>
      <p class="text-sm text-zinc-500 mb-6">
        Wiederverwendbare Prozeduren (z. B. Tool-Skills wie o365-cli, gmail-cli) — einmal definiert, Agents in jeder Firma zuweisbar.
      </p>

      <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />
      <div v-if="loading" class="text-zinc-500 py-10 text-center">
        Lädt …
      </div>
      <div v-else-if="!items.length" class="text-zinc-600 italic py-10 text-center">
        Noch kein Bibliotheks-Skill. Leg den ersten an — z. B. „o365-cli: Microsoft 365 Mail & Kalender".
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="s in items"
          :key="s.id"
          class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 cursor-pointer hover:border-zinc-700"
          @click="openEdit(s)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium truncate">{{ s.name || '(ohne Name)' }}</span>
                <UBadge v-for="t in s.assignedTo" :key="t" :color="t === 'ceo' ? 'primary' : 'neutral'" variant="subtle" size="xs">
                  {{ labelFor(t) }}
                </UBadge>
                <UBadge v-if="!s.assignedTo.length" color="warning" variant="subtle" size="xs">
                  niemandem zugeordnet
                </UBadge>
              </div>
              <p class="text-xs text-zinc-500 mt-1 line-clamp-2">
                {{ s.description }}
              </p>
            </div>
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :loading="busy[s.id]" @click.stop="remove(s)" />
          </div>
        </div>
      </div>
    </main>

    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ editingId ? 'Skill bearbeiten' : 'Skill hinzufügen' }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showForm = false" />
          </div>
          <UFormField label="Name" description="Kurzer Bezeichner.">
            <UInput v-model="form.name" placeholder="o365-cli" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Beschreibung" description="Wofür/wann — der Agent wählt den Skill darüber aus.">
            <UInput v-model="form.description" placeholder="Microsoft 365 Mail & Kalender via o365-cli." class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Anweisung (prompt)" description="Wie man das Werkzeug bedient — der Agent bekommt genau diesen Text.">
            <UTextarea v-model="form.prompt" :rows="10" placeholder="## o365-cli&#10;- mail search …&#10;- calendar create …" class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Zugeordnet an" description="Wer diesen Skill einsetzen darf — firmenübergreifend.">
            <div class="space-y-3 pt-1">
              <label class="flex items-center gap-2 cursor-pointer text-sm">
                <UCheckbox :model-value="form.assignedTo.includes('ceo')" @update:model-value="toggleTarget('ceo')" />
                Operator (alle Firmen)
              </label>
              <div v-for="grp in agentsByOrg" :key="grp.orgName">
                <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                  {{ grp.orgName }}
                </div>
                <div class="flex flex-wrap gap-3">
                  <label v-for="a in grp.list" :key="a.id" class="flex items-center gap-2 cursor-pointer text-sm">
                    <UCheckbox :model-value="form.assignedTo.includes(a.id)" @update:model-value="toggleTarget(a.id)" />
                    {{ a.label }}
                  </label>
                </div>
              </div>
            </div>
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
  </div>
</template>
