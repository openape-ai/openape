<script setup lang="ts">
import type { Stage } from '#shared/stages'
import type { Deal } from '../utils/board'
import { useOpenApeAuth } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'
import { STAGE_LABELS, STAGES } from '#shared/stages'
import { apiFetch } from '../utils/api'
import { buildColumns, dropInto } from '../utils/board'

interface ContactRow { id: string, name: string, org_name: string | null }
interface Note { id: string, body: string, author_email: string, created_at: number }

const { user, fetchUser } = useOpenApeAuth()
const { list: workspaces, activeId, load: loadWorkspaces, create: createWorkspace } = useWorkspaces()

const loading = ref(true)
const deals = ref<Deal[]>([])
const contacts = ref<ContactRow[]>([])
const columns = computed(() => buildColumns(deals.value))
const draggedId = ref<string | null>(null)

const newWorkspaceName = ref('')
const showNewDeal = ref(false)
const newDeal = ref({ title: '', euro: 0, stage: 'lead' as Stage, contact_id: '' })

const openDeal = ref<Deal | null>(null)
const notes = ref<Note[]>([])
const noteBody = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  await loadWorkspaces()
  await reload()
  loading.value = false
})

watch(activeId, reload)

async function reload() {
  if (!activeId.value) {
    deals.value = []
    contacts.value = []
    return
  }
  const [d, c] = await Promise.all([
    apiFetch<Deal[]>(`/api/deals?workspace_id=${activeId.value}`),
    apiFetch<ContactRow[]>(`/api/contacts?workspace_id=${activeId.value}`),
  ])
  deals.value = d
  contacts.value = c
}

async function onDrop(stage: string, beforeId: string | null) {
  const dealId = draggedId.value
  draggedId.value = null
  if (!dealId) return

  const column = columns.value.find(c => c.stage === stage)!
  const ids = dropInto(column.deals.map(d => d.id), dealId, beforeId)
  await apiFetch('/api/deals/reorder', {
    method: 'POST',
    body: { workspace_id: activeId.value, stage, ids },
  })
  await reload()
}

async function moveDeal(deal: Deal, stage: string) {
  await apiFetch(`/api/deals/${deal.id}`, { method: 'PATCH', body: { stage } })
  await reload()
}

async function submitNewDeal() {
  await apiFetch('/api/deals', {
    method: 'POST',
    body: {
      workspace_id: activeId.value,
      title: newDeal.value.title,
      value_cents: Math.round(newDeal.value.euro * 100),
      stage: newDeal.value.stage,
      contact_id: newDeal.value.contact_id || null,
    },
  })
  showNewDeal.value = false
  newDeal.value = { title: '', euro: 0, stage: 'lead', contact_id: '' }
  await reload()
}

async function show(deal: Deal) {
  openDeal.value = deal
  noteBody.value = ''
  notes.value = await apiFetch<Note[]>(`/api/deals/${deal.id}/notes`)
}

async function addNote() {
  const body = noteBody.value.trim()
  if (!body || !openDeal.value) return
  await apiFetch(`/api/deals/${openDeal.value.id}/notes`, { method: 'POST', body: { body } })
  noteBody.value = ''
  notes.value = await apiFetch<Note[]>(`/api/deals/${openDeal.value.id}/notes`)
}

async function removeDeal() {
  if (!openDeal.value) return
  await apiFetch(`/api/deals/${openDeal.value.id}`, { method: 'DELETE' })
  openDeal.value = null
  await reload()
}

const stageItems = STAGES.map(stage => ({ label: STAGE_LABELS[stage], value: stage }))
const contactItems = computed(() => [
  { label: 'ohne Kontakt', value: '' },
  ...contacts.value.map(c => ({ label: c.org_name ? `${c.name} (${c.org_name})` : c.name, value: c.id })),
])
</script>

<template>
  <main class="mx-auto max-w-7xl px-4 py-6">
    <div v-if="loading" class="text-zinc-500">
      Lade …
    </div>

    <!-- Erster Login: ohne Workspace gibt es nichts zu zeigen. -->
    <UCard v-else-if="!workspaces.length" class="max-w-md">
      <template #header>
        <h1 class="text-lg font-semibold">
          Ersten Workspace anlegen
        </h1>
      </template>
      <form class="space-y-3" @submit.prevent="createWorkspace(newWorkspaceName).then(reload)">
        <UInput v-model="newWorkspaceName" placeholder="z.B. Delta Mind" size="lg" class="w-full" />
        <UButton type="submit" block :disabled="!newWorkspaceName.trim()">
          Anlegen
        </UButton>
      </form>
    </UCard>

    <template v-else>
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-xl font-semibold">
          Pipeline
        </h1>
        <UButton icon="i-lucide-plus" @click="showNewDeal = true">
          Neuer Deal
        </UButton>
      </div>

      <div class="mt-6 flex gap-4 overflow-x-auto pb-4">
        <BoardColumn
          v-for="column in columns"
          :key="column.stage"
          :column="column"
          @drag-card="draggedId = $event"
          @drop-on="onDrop(column.stage, $event)"
          @open="show"
          @move="moveDeal"
        />
      </div>
    </template>

    <UModal v-model:open="showNewDeal">
      <template #content>
        <form class="max-w-md space-y-4 p-6" @submit.prevent="submitNewDeal">
          <h2 class="text-lg font-semibold">
            Neuer Deal
          </h2>
          <UFormField label="Titel" required>
            <UInput v-model="newDeal.title" maxlength="200" size="lg" class="w-full" />
          </UFormField>
          <UFormField label="Wert (EUR)">
            <UInput v-model.number="newDeal.euro" type="number" min="0" step="100" size="lg" class="w-full" />
          </UFormField>
          <UFormField label="Stufe">
            <USelect v-model="newDeal.stage" :items="stageItems" size="lg" class="w-full" />
          </UFormField>
          <UFormField label="Kontakt">
            <USelect v-model="newDeal.contact_id" :items="contactItems" size="lg" class="w-full" />
          </UFormField>
          <UButton type="submit" block size="lg" :disabled="!newDeal.title.trim()">
            Anlegen
          </UButton>
        </form>
      </template>
    </UModal>

    <UModal :open="!!openDeal" @update:open="openDeal = null">
      <template #content>
        <div v-if="openDeal" class="max-w-md space-y-4 p-6">
          <div>
            <h2 class="text-lg font-semibold">
              {{ openDeal.title }}
            </h2>
            <p class="text-sm text-zinc-400">
              {{ STAGE_LABELS[openDeal.stage] }}
              <span v-if="openDeal.contact_name"> · {{ openDeal.contact_name }}</span>
              <span v-if="openDeal.org_name"> · {{ openDeal.org_name }}</span>
            </p>
          </div>

          <form class="space-y-2" @submit.prevent="addNote">
            <UTextarea v-model="noteBody" :rows="3" placeholder="Notiz …" class="w-full" />
            <UButton type="submit" size="sm" :disabled="!noteBody.trim()">
              Notiz speichern
            </UButton>
          </form>

          <ul class="space-y-2">
            <li v-for="note in notes" :key="note.id" class="rounded-lg bg-zinc-900 p-3 text-sm">
              <p class="whitespace-pre-wrap">
                {{ note.body }}
              </p>
              <p class="mt-1 text-xs text-zinc-500">
                {{ note.author_email }} · {{ new Date(note.created_at).toLocaleString('de-AT') }}
              </p>
            </li>
          </ul>

          <UButton color="error" variant="ghost" size="sm" @click="removeDeal">
            Deal löschen
          </UButton>
        </div>
      </template>
    </UModal>
  </main>
</template>
