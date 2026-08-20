<script setup lang="ts">
import type { Outcome, PipelineStage } from '#shared/stages'
import type { Deal } from '../utils/board'
import { useOpenApeAuth } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'
import { MAX_STAGE_NAME } from '#shared/stages'
import { apiFetch } from '../utils/api'
import { buildColumns, dropInto } from '../utils/board'
import { problemMessage } from '../utils/problem-message'

interface ContactRow { id: string, name: string, org_name: string | null }
interface Note { id: string, body: string, author_email: string, created_at: number }

const { user, fetchUser } = useOpenApeAuth()
const { list: workspaces, active, activeId, load: loadWorkspaces, create: createWorkspace } = useWorkspaces()
const { run } = useApiAction()

const loading = ref(true)
const loadError = ref('')
const deals = ref<Deal[]>([])
const contacts = ref<ContactRow[]>([])
const stages = ref<PipelineStage[]>([])
const columns = computed(() => buildColumns(deals.value, stages.value))
/** Die Pipeline ist Konfiguration — daran darf nur, wer auch einladen darf. */
const canEditStages = computed(() => active.value?.role === 'owner' || active.value?.role === 'manager')
const draggedId = ref<string | null>(null)

const newWorkspaceName = ref('')
const showNewDeal = ref(false)
const newDeal = ref({ title: '', euro: null as number | null, stage: '', contact_id: '' })

const openDeal = ref<Deal | null>(null)
const edit = ref({ title: '', euro: null as number | null, stage: '', contact_id: '' })
const saving = ref(false)
const notes = ref<Note[]>([])
const noteBody = ref('')
const confirmDelete = ref(false)

const showNewStage = ref(false)
const newStageName = ref('')
const newStageOutcome = ref<Outcome>('open')
const insertAfter = ref<string | null>(null)
const removingStage = ref<PipelineStage | null>(null)
const moveTo = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  try {
    await loadWorkspaces()
    await reload()
  }
  catch (error) {
    loadError.value = problemMessage(error, 'Board konnte nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch(activeId, () => void reload())

async function reload() {
  if (!activeId.value) {
    deals.value = []
    contacts.value = []
    stages.value = []
    return
  }
  const [d, c, s] = await Promise.all([
    apiFetch<Deal[]>(`/api/deals?workspace_id=${activeId.value}`),
    apiFetch<ContactRow[]>(`/api/contacts?workspace_id=${activeId.value}`),
    apiFetch<PipelineStage[]>(`/api/stages?workspace_id=${activeId.value}`),
  ])
  deals.value = d
  contacts.value = c
  stages.value = s
}

/** Nach jeder Änderung: frisch vom Server, damit Positionen nicht auseinanderlaufen. */
async function refresh() {
  await run(() => reload(), { failure: 'Board konnte nicht aktualisiert werden' })
}

async function onDrop(stage: string, beforeId: string | null) {
  const dealId = draggedId.value
  draggedId.value = null
  if (!dealId) return

  const column = columns.value.find(c => c.stage.key === stage)!
  const ids = dropInto(column.deals.map(d => d.id), dealId, beforeId)
  const moved = await run(
    () => apiFetch('/api/deals/reorder', {
      method: 'POST',
      body: { workspace_id: activeId.value, stage, ids },
    }),
    { failure: 'Karte konnte nicht verschoben werden' },
  )
  if (moved !== null) await refresh()
}

async function moveDeal(deal: Deal, stage: string) {
  const moved = await run(
    () => apiFetch(`/api/deals/${deal.id}`, { method: 'PATCH', body: { stage } }),
    { success: `„${deal.title}" ist jetzt ${stageName(stage)}`, failure: 'Stufe konnte nicht geändert werden' },
  )
  if (moved !== null) await refresh()
}

async function submitNewDeal() {
  const created = await run(
    () => apiFetch('/api/deals', {
      method: 'POST',
      body: {
        workspace_id: activeId.value,
        title: newDeal.value.title,
        value_cents: Math.round((newDeal.value.euro ?? 0) * 100),
        stage: newDeal.value.stage,
        contact_id: newDeal.value.contact_id || null,
      },
    }),
    { success: 'Deal angelegt', failure: 'Deal konnte nicht angelegt werden' },
  )
  if (created === null) return
  showNewDeal.value = false
  newDeal.value = { title: '', euro: null, stage: stages.value[0]?.key ?? '', contact_id: '' }
  await refresh()
}

async function addFirstWorkspace() {
  const created = await run(
    () => createWorkspace(newWorkspaceName.value),
    { success: 'Workspace angelegt', failure: 'Workspace konnte nicht angelegt werden' },
  )
  if (created === null) return
  newWorkspaceName.value = ''
  await refresh()
}

function openNewDeal() {
  newDeal.value = { title: '', euro: null, stage: stages.value[0]?.key ?? '', contact_id: '' }
  showNewDeal.value = true
}

async function patchStage(stage: PipelineStage, body: Record<string, unknown>, success: string) {
  const saved = await run(
    () => apiFetch(`/api/stages/${stage.key}`, {
      method: 'PATCH',
      body: { workspace_id: activeId.value, ...body },
    }),
    { success, failure: 'Stufe konnte nicht geändert werden' },
  )
  if (saved !== null) await refresh()
}

async function addStage(after: string | null) {
  const created = await run(
    () => apiFetch<PipelineStage>('/api/stages', {
      method: 'POST',
      body: { workspace_id: activeId.value, name: newStageName.value, outcome: newStageOutcome.value, after },
    }),
    { success: `Stufe „${newStageName.value.trim()}" angelegt`, failure: 'Stufe konnte nicht angelegt werden' },
  )
  if (created === null) return
  newStageName.value = ''
  newStageOutcome.value = 'open'
  insertAfter.value = null
  showNewStage.value = false
  await refresh()
}

/** Löschen fragt zwingend nach dem Ziel — kein Deal verschwindet mit seiner Spalte. */
function askRemoveStage(stage: PipelineStage) {
  removingStage.value = stage
  moveTo.value = stages.value.find(s => s.key !== stage.key)?.key ?? ''
}

async function removeStage() {
  const stage = removingStage.value
  if (!stage) return
  const query = new URLSearchParams({ workspace_id: activeId.value })
  if (moveTo.value) query.set('move_to', moveTo.value)
  const deleted = await run(
    () => apiFetch(`/api/stages/${stage.key}?${query}`, { method: 'DELETE' }),
    { success: `Stufe „${stage.name}" gelöscht`, failure: 'Stufe konnte nicht gelöscht werden' },
  )
  removingStage.value = null
  if (deleted === null) return
  await refresh()
}

function show(deal: Deal) {
  openDeal.value = deal
  edit.value = {
    title: deal.title,
    euro: deal.value_cents / 100,
    stage: deal.stage,
    contact_id: deal.contact_id ?? '',
  }
  noteBody.value = ''
  notes.value = []
  void loadNotes(deal.id)
}

async function loadNotes(dealId: string) {
  const loaded = await run(
    () => apiFetch<Note[]>(`/api/deals/${dealId}/notes`),
    { failure: 'Notizen konnten nicht geladen werden' },
  )
  if (loaded) notes.value = loaded
}

async function saveDeal() {
  const deal = openDeal.value
  if (!deal) return
  saving.value = true
  const saved = await run(
    () => apiFetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      body: {
        title: edit.value.title,
        value_cents: Math.round((edit.value.euro ?? 0) * 100),
        stage: edit.value.stage,
        contact_id: edit.value.contact_id || null,
      },
    }),
    { success: 'Deal gespeichert', failure: 'Deal konnte nicht gespeichert werden' },
  )
  saving.value = false
  if (saved === null) return
  openDeal.value = null
  await refresh()
}

async function addNote() {
  const deal = openDeal.value
  const body = noteBody.value.trim()
  if (!body || !deal) return
  const added = await run(
    () => apiFetch(`/api/deals/${deal.id}/notes`, { method: 'POST', body: { body } }),
    { success: 'Notiz gespeichert', failure: 'Notiz konnte nicht gespeichert werden' },
  )
  if (added === null) return
  noteBody.value = ''
  await loadNotes(deal.id)
}

async function removeDeal() {
  const deal = openDeal.value
  if (!deal) return
  const deleted = await run(
    () => apiFetch(`/api/deals/${deal.id}`, { method: 'DELETE' }),
    { success: `„${deal.title}" gelöscht`, failure: 'Deal konnte nicht gelöscht werden' },
  )
  confirmDelete.value = false
  if (deleted === null) return
  openDeal.value = null
  await refresh()
}

function retry() {
  window.location.reload()
}

const stageItems = computed(() => stages.value.map(stage => ({ label: stage.name, value: stage.key })))
function stageName(key: string): string {
  return stages.value.find(s => s.key === key)?.name ?? key
}
const contactItems = computed(() => [
  { label: 'ohne Kontakt', value: '' },
  ...contacts.value.map(c => ({ label: c.org_name ? `${c.name} (${c.org_name})` : c.name, value: c.id })),
])
const OUTCOME_LABELS: Record<Outcome, string> = { open: 'offen', won: 'gewonnen', lost: 'verloren' }
function outcomeLabel(outcome: Outcome): string {
  return OUTCOME_LABELS[outcome]
}
const outcomeItems = [
  { label: 'Offen', value: 'open' },
  { label: 'Gewonnen', value: 'won' },
  { label: 'Verloren', value: 'lost' },
]
const removingCount = computed(() =>
  columns.value.find(c => c.stage.key === removingStage.value?.key)?.deals.length ?? 0,
)
const moveTargets = computed(() =>
  stages.value
    .filter(s => s.key !== removingStage.value?.key)
    .map(s => ({ label: s.name, value: s.key })),
)
const deleteConsequence = computed(() =>
  notes.value.length
    ? `„${openDeal.value?.title}" wird samt ${notes.value.length} Notiz${notes.value.length === 1 ? '' : 'en'} entfernt. Das lässt sich nicht rückgängig machen.`
    : `„${openDeal.value?.title}" wird entfernt. Das lässt sich nicht rückgängig machen.`,
)
</script>

<template>
  <main class="mx-auto max-w-7xl px-4 py-6">
    <div v-if="loading" class="text-zinc-500">
      Lade …
    </div>

    <UCard v-else-if="loadError" class="max-w-md">
      <template #header>
        <h1 class="text-lg font-semibold">
          Board konnte nicht geladen werden
        </h1>
      </template>
      <p class="text-sm text-zinc-400">
        {{ loadError }}
      </p>
      <template #footer>
        <UButton @click="retry">
          Erneut versuchen
        </UButton>
      </template>
    </UCard>

    <!-- Erster Login: ohne Workspace gibt es nichts zu zeigen. -->
    <UCard v-else-if="!workspaces.length" class="max-w-md">
      <template #header>
        <h1 class="text-lg font-semibold">
          Ersten Workspace anlegen
        </h1>
      </template>
      <form class="space-y-3" @submit.prevent="addFirstWorkspace">
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
        <UButton icon="i-lucide-plus" @click="openNewDeal">
          Neuer Deal
        </UButton>
      </div>

      <div class="mt-6 flex gap-4 overflow-x-auto pb-4">
        <BoardColumn
          v-for="column in columns"
          :key="column.stage.key"
          :column="column"
          :stages="stages"
          :editable="canEditStages"
          @drag-card="draggedId = $event"
          @drop-on="onDrop(column.stage.key, $event)"
          @open="show"
          @move="moveDeal"
          @rename="patchStage(column.stage, { name: $event }, `Stufe heißt jetzt „${$event}“`)"
          @outcome="patchStage(column.stage, { outcome: $event }, `„${column.stage.name}“ zählt jetzt als ${outcomeLabel($event)}`)"
          @reposition="patchStage(column.stage, { position: $event }, `„${column.stage.name}“ verschoben`)"
          @insert-after="insertAfter = column.stage.key; showNewStage = true"
          @remove="askRemoveStage(column.stage)"
        />

        <!-- Der sichtbare Beweis, dass die Spalten nichts Festes sind. -->
        <button
          v-if="canEditStages"
          type="button"
          class="flex w-48 shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 p-3 text-sm text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
          @click="insertAfter = null; showNewStage = true"
        >
          <UIcon name="i-lucide-plus" class="size-4" />
          Stufe
        </button>
      </div>
    </template>

    <UModal v-model:open="showNewDeal">
      <template #content>
        <form class="max-w-md space-y-4 p-6" @submit.prevent="submitNewDeal">
          <h2 class="text-lg font-semibold">
            Neuer Deal
          </h2>
          <UFormField label="Titel" required>
            <UInput v-model="newDeal.title" maxlength="200" size="lg" class="w-full" autofocus />
          </UFormField>
          <UFormField label="Wert (EUR)">
            <UInput v-model.number="newDeal.euro" type="number" min="0" step="100" placeholder="0" size="lg" class="w-full" />
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
        <div v-if="openDeal" class="max-w-md space-y-5 p-6">
          <form class="space-y-4" @submit.prevent="saveDeal">
            <UFormField label="Titel" required>
              <UInput v-model="edit.title" maxlength="200" size="lg" class="w-full" />
            </UFormField>
            <div class="grid grid-cols-2 gap-3">
              <UFormField label="Wert (EUR)">
                <UInput v-model.number="edit.euro" type="number" min="0" step="100" class="w-full" />
              </UFormField>
              <UFormField label="Stufe">
                <USelect v-model="edit.stage" :items="stageItems" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Kontakt">
              <USelect v-model="edit.contact_id" :items="contactItems" class="w-full" />
            </UFormField>
            <UButton type="submit" :loading="saving" :disabled="!edit.title.trim()">
              Speichern
            </UButton>
          </form>

          <div class="border-t border-zinc-800 pt-4">
            <form class="space-y-2" @submit.prevent="addNote">
              <UTextarea v-model="noteBody" :rows="3" placeholder="Notiz …" class="w-full" />
              <UButton type="submit" size="sm" variant="subtle" :disabled="!noteBody.trim()">
                Notiz speichern
              </UButton>
            </form>

            <ul class="mt-3 space-y-2">
              <li v-for="note in notes" :key="note.id" class="rounded-lg bg-zinc-900 p-3 text-sm">
                <p class="whitespace-pre-wrap">
                  {{ note.body }}
                </p>
                <p class="mt-1 text-xs text-zinc-500">
                  {{ note.author_email }} · {{ new Date(note.created_at).toLocaleString('de-AT') }}
                </p>
              </li>
            </ul>
          </div>

          <UButton color="error" variant="ghost" size="sm" @click="confirmDelete = true">
            Deal löschen
          </UButton>
        </div>
      </template>
    </UModal>

    <ConfirmDialog
      v-model:open="confirmDelete"
      title="Deal löschen?"
      :consequence="deleteConsequence"
      @confirm="removeDeal"
    />

    <UModal v-model:open="showNewStage">
      <template #content>
        <form class="max-w-sm space-y-4 p-6" @submit.prevent="addStage(insertAfter)">
          <h2 class="text-lg font-semibold">
            Neue Stufe
          </h2>
          <UFormField label="Name" :hint="insertAfter ? `nach „${stageName(insertAfter)}“` : 'am Ende der Pipeline'">
            <UInput v-model="newStageName" :maxlength="MAX_STAGE_NAME" size="lg" class="w-full" autofocus />
          </UFormField>
          <UFormField label="Ergebnis" hint="schließt den Deal ab">
            <USelect v-model="newStageOutcome" :items="outcomeItems" size="lg" class="w-full" />
          </UFormField>
          <UButton type="submit" block size="lg" :disabled="!newStageName.trim()">
            Anlegen
          </UButton>
        </form>
      </template>
    </UModal>

    <UModal :open="!!removingStage" @update:open="removingStage = null">
      <template #content>
        <form v-if="removingStage" class="max-w-sm space-y-4 p-6" @submit.prevent="removeStage">
          <h2 class="text-lg font-semibold">
            Stufe „{{ removingStage.name }}“ löschen?
          </h2>
          <p class="text-sm text-zinc-400">
            {{ removingCount
              ? `${removingCount} Deal${removingCount === 1 ? '' : 's'} liegen darin und brauchen eine neue Stufe.`
              : 'Die Stufe ist leer.' }}
          </p>
          <UFormField v-if="removingCount" label="Deals verschieben nach">
            <USelect v-model="moveTo" :items="moveTargets" size="lg" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="removingStage = null">
              Abbrechen
            </UButton>
            <UButton type="submit" color="error" :disabled="!!removingCount && !moveTo">
              Löschen
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </main>
</template>
