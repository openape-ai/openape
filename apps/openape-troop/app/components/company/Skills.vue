<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

// Skills panel: reusable named procedures assigned to agents. An assigned agent
// picks a skill by its description and follows the prompt (M2 fetch). Assignment
// targets: the Operator ('ceo') and/or the org's delegation agents.
const props = defineProps<{ orgId: string, agents: { id: string, role: string, label: string }[] }>()

interface Skill { id: string, name: string, description: string, prompt: string, assignedTo: string[], updatedAt: number }

// The Operator is a fixed target; the rest are the (non-Operator) delegation agents.
const targetOptions = computed(() => [
  { value: 'ceo', label: 'Operator' },
  ...props.agents.filter(a => a.role !== 'ceo').map(a => ({ value: a.id, label: a.label })),
])
const targetLabel = (t: string) => targetOptions.value.find(o => o.value === t)?.label ?? t

const items = ref<Skill[]>([])
const loading = ref(true)
const busy = reactive<Record<string, boolean>>({})

async function load() {
  loading.value = true
  items.value = await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/skills`)
  loading.value = false
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
    if (editingId.value) await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/skills/${editingId.value}`, { method: 'PATCH', body })
    else await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/skills`, { method: 'POST', body })
    showForm.value = false
    await load()
  }
  catch (err: any) { formError.value = err?.data?.statusMessage || 'Speichern fehlgeschlagen.' }
  finally { saving.value = false }
}
async function remove(s: Skill) {
  busy[s.id] = true
  try {
    await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/skills/${s.id}`, { method: 'DELETE' })
    await load()
  }
  finally { busy[s.id] = false }
}

watch(() => props.orgId, load, { immediate: true })
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <p class="text-sm text-zinc-500">
        Wiederverwendbare Prozeduren — ein zugeordneter Agent setzt sie ein, wenn eine Aufgabe passt.
      </p>
      <UButton color="primary" icon="i-lucide-plus" @click="openAdd">
        Skill
      </UButton>
    </div>

    <div v-if="loading" class="text-zinc-500 py-10 text-center">
      Lädt …
    </div>
    <div v-else-if="!items.length" class="text-zinc-600 italic py-10 text-center">
      Noch kein Skill. Leg den ersten an — z. B. „monatsbericht: erstellt den Monatsbericht".
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
                {{ targetLabel(t) }}
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
            <UInput v-model="form.name" placeholder="monatsbericht" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Beschreibung" description="Wofür/wann — der Agent wählt den Skill darüber aus.">
            <UInput v-model="form.description" placeholder="Erstellt den Monatsbericht aus den Zahlen." class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Anweisung (prompt)" description="Der Agent bekommt genau diesen Text und befolgt ihn.">
            <UTextarea v-model="form.prompt" :rows="10" placeholder="## Schritte&#10;1. …" class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Zugeordnet an" description="Wer diesen Skill einsetzen darf.">
            <div class="flex flex-wrap gap-3 pt-1">
              <label v-for="o in targetOptions" :key="o.value" class="flex items-center gap-2 cursor-pointer text-sm">
                <UCheckbox :model-value="form.assignedTo.includes(o.value)" @update:model-value="toggleTarget(o.value)" />
                {{ o.label }}
              </label>
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
