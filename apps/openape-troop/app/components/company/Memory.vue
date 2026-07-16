<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

// Memory panel: owner-authored facts the Operator reads. company-scope reaches every
// employee; role/agent-scope is surfaced when a topic matches. Small docs ride
// inline in the prompt, big ones become reference docs fetched on demand.
const props = defineProps<{ orgId: string }>()

interface Doc { id: string, scope: string, targetId: string, title: string, body: string, mode: string, updatedAt: number }

const SCOPES = [
  { label: 'Firma (alle)', value: 'company' },
  { label: 'Rolle', value: 'role' },
  { label: 'Agent', value: 'agent' },
]
const MODES = [
  { label: 'Automatisch (nach Größe)', value: 'auto' },
  { label: 'Inline (immer im Prompt)', value: 'inline' },
  { label: 'Referenz (bei Bedarf)', value: 'reference' },
]

const items = ref<Doc[]>([])
const loading = ref(true)
const busy = reactive<Record<string, boolean>>({})

async function load() {
  loading.value = true
  items.value = await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/memory`)
  loading.value = false
}

const showForm = ref(false)
const editingId = ref('')
const saving = ref(false)
const formError = ref('')
const form = reactive({ scope: 'company', targetId: '', title: '', body: '', mode: 'auto' })

function openAdd() {
  editingId.value = ''
  Object.assign(form, { scope: 'company', targetId: '', title: '', body: '', mode: 'auto' })
  formError.value = ''
  showForm.value = true
}
function openEdit(d: Doc) {
  editingId.value = d.id
  Object.assign(form, { scope: d.scope, targetId: d.targetId, title: d.title, body: d.body, mode: d.mode })
  formError.value = ''
  showForm.value = true
}

const scopeLabel = (s: string) => SCOPES.find(x => x.value === s)?.label ?? s

async function submit() {
  if (!form.title.trim() && !form.body.trim()) { formError.value = 'Titel oder Inhalt nötig.'; return }
  saving.value = true
  formError.value = ''
  const body: Record<string, unknown> = { scope: form.scope, targetId: form.targetId.trim(), title: form.title.trim(), body: form.body }
  if (form.mode !== 'auto') body.mode = form.mode
  try {
    if (editingId.value) await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/memory/${editingId.value}`, { method: 'PATCH', body })
    else await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/memory`, { method: 'POST', body })
    showForm.value = false
    await load()
  }
  catch (err: any) { formError.value = err?.data?.statusMessage || 'Speichern fehlgeschlagen.' }
  finally { saving.value = false }
}
async function remove(d: Doc) {
  busy[d.id] = true
  try {
    await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/memory/${d.id}`, { method: 'DELETE' })
    await load()
  }
  finally { busy[d.id] = false }
}

watch(() => props.orgId, load, { immediate: true })
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <p class="text-sm text-zinc-500">
        Fakten, die deine Firma kennt — der Operator liest sie beim Antworten.
      </p>
      <UButton color="primary" icon="i-lucide-plus" @click="openAdd">
        Memory
      </UButton>
    </div>

    <div v-if="loading" class="text-zinc-500 py-10 text-center">
      Lädt …
    </div>
    <div v-else-if="!items.length" class="text-zinc-600 italic py-10 text-center">
      Noch kein Memory. Leg das erste an — z. B. „so ist die Datenablage strukturiert".
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="d in items"
        :key="d.id"
        class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 cursor-pointer hover:border-zinc-700"
        @click="openEdit(d)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium truncate">{{ d.title || '(ohne Titel)' }}</span>
              <UBadge color="neutral" variant="subtle" size="xs">
                {{ scopeLabel(d.scope) }}{{ d.targetId ? `: ${d.targetId}` : '' }}
              </UBadge>
              <UBadge :color="d.mode === 'reference' ? 'info' : 'neutral'" variant="subtle" size="xs">
                {{ d.mode }}
              </UBadge>
            </div>
            <p class="text-xs text-zinc-500 mt-1 line-clamp-2">
              {{ d.body }}
            </p>
          </div>
          <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :loading="busy[d.id]" @click.stop="remove(d)" />
        </div>
      </div>
    </div>

    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ editingId ? 'Memory bearbeiten' : 'Memory hinzufügen' }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showForm = false" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Gültig für">
              <USelect v-model="form.scope" :items="SCOPES" class="w-full" />
            </UFormField>
            <UFormField v-if="form.scope !== 'company'" label="Rolle / Agent-ID" description="An wen (Rollen-Name oder Agent-id).">
              <UInput v-model="form.targetId" placeholder="buchhaltung" class="w-full" :ui="{ base: 'w-full' }" />
            </UFormField>
          </div>
          <UFormField label="Titel" description="Kurz — der Operator sieht ihn, um zu entscheiden, ob das Memory passt.">
            <UInput v-model="form.title" placeholder="Datenablage-Struktur" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Inhalt">
            <UTextarea v-model="form.body" :rows="12" placeholder="Rechnungen liegen unter …" class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Modus" description="Automatisch: kleine Docs inline, große als Referenz (~1500 Zeichen).">
            <USelect v-model="form.mode" :items="MODES" class="w-full" />
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
