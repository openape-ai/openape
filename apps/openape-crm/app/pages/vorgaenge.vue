<script setup lang="ts">
import type { WizardProduct } from '../components/OfferWizard.vue'
import type { Phase } from '#shared/pipelines'
import type { Deal } from '../utils/board'
import { useOpenApeAuth } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'
import { isPhase } from '#shared/pipelines'
import { apiFetch } from '../utils/api'
import { NO_SELECTION, selectionToId } from '../utils/board'
import { problemMessage } from '../utils/problem-message'

interface ContactRow { id: string, name: string, org_name: string | null }
interface Note { id: string, kind: string, title: string, body: string, author_email: string, created_at: number }

const { user, fetchUser } = useOpenApeAuth()
const { list: workspaces, activeId, load: loadWorkspaces, create: createWorkspace } = useWorkspaces()
const { run } = useApiAction()
const route = useRoute()
const router = useRouter()

const loading = ref(true)
const loadError = ref('')
const deals = ref<Deal[]>([])
const contacts = ref<ContactRow[]>([])
const newWorkspaceName = ref('')
const showNewDeal = ref(false)
const newDeal = ref({ title: '', euro: null as number | null, contact_id: NO_SELECTION })
const notes = ref<Note[]>([])
const noteBody = ref('')
const confirmDelete = ref(false)
const products = ref<WizardProduct[]>([])
const { status: graphStatus, reload: reloadGraph } = useGraph()

const phase = computed<Phase>(() => (isPhase(route.query.phase) ? route.query.phase : 'deal'))
const selected = computed(() => deals.value.find(d => d.id === route.query.id) ?? deals.value.find(d => d.phase === phase.value) ?? deals.value[0] ?? null)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  try {
    await loadWorkspaces()
    await Promise.all([reload(), reloadGraph()])
  }
  catch (error) {
    loadError.value = problemMessage(error, 'Vorgänge konnten nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch(activeId, () => void reload())
watch(() => selected.value?.id, (id) => {
  if (id) void loadNotes(id)
  else notes.value = []
})

async function reload() {
  if (!activeId.value) {
    deals.value = []
    contacts.value = []
    return
  }
  const [d, c, p] = await Promise.all([
    apiFetch<Deal[]>(`/api/deals?workspace_id=${activeId.value}`),
    apiFetch<ContactRow[]>(`/api/contacts?workspace_id=${activeId.value}`),
    apiFetch<WizardProduct[]>(`/api/products?workspace_id=${activeId.value}`).catch(() => []),
  ])
  deals.value = d.map(row => ({
    ...row,
    stage: row.stufe,
    people: row.people ?? [],
  }))
  contacts.value = c
  products.value = p
}

async function setPhase(next: Phase) {
  const first = deals.value.find(d => d.phase === next)
  await router.replace({ query: { phase: next, ...(first ? { id: first.id } : {}) } })
}

async function openDeal(deal: Deal) {
  await router.replace({ query: { phase: deal.phase, id: deal.id } })
}

async function setStufe(stufe: string) {
  const deal = selected.value
  if (!deal) return
  const moved = await run(
    () => apiFetch(`/api/deals/${deal.id}`, { method: 'PATCH', body: { stufe } }),
    { failure: 'Stufe konnte nicht geändert werden' },
  )
  if (moved !== null) await reload()
}

async function loadNotes(dealId: string) {
  const loaded = await run(
    () => apiFetch<Note[]>(`/api/deals/${dealId}/notes`),
    { failure: 'Notizen konnten nicht geladen werden' },
  )
  if (loaded) notes.value = loaded
}

async function addNote() {
  const deal = selected.value
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

async function submitNewDeal() {
  const created = await run(
    () => apiFetch('/api/deals', {
      method: 'POST',
      body: {
        workspace_id: activeId.value,
        title: newDeal.value.title,
        value_cents: Math.round((newDeal.value.euro ?? 0) * 100),
        phase: phase.value,
        contact_id: selectionToId(newDeal.value.contact_id),
      },
    }),
    { success: 'Vorgang angelegt', failure: 'Vorgang konnte nicht angelegt werden' },
  )
  if (created === null) return
  showNewDeal.value = false
  newDeal.value = { title: '', euro: null, contact_id: NO_SELECTION }
  await reload()
}

async function addFirstWorkspace() {
  const created = await run(
    () => createWorkspace(newWorkspaceName.value),
    { success: 'Workspace angelegt', failure: 'Workspace konnte nicht angelegt werden' },
  )
  if (created === null) return
  newWorkspaceName.value = ''
  await reload()
}

async function removeDeal() {
  const deal = selected.value
  if (!deal) return
  const deleted = await run(
    () => apiFetch(`/api/deals/${deal.id}`, { method: 'DELETE' }),
    { success: `„${deal.title}" gelöscht`, failure: 'Vorgang konnte nicht gelöscht werden' },
  )
  confirmDelete.value = false
  if (deleted === null) return
  await router.replace({ query: { phase: phase.value } })
  await reload()
}

const contactItems = computed(() => [
  { label: 'ohne Kontakt', value: NO_SELECTION },
  ...contacts.value.map(c => ({ label: c.org_name ? `${c.name} (${c.org_name})` : c.name, value: c.id })),
])
</script>

<template>
  <div v-if="loading" class="p-6 text-[var(--crm-ink-3)]">
    Lade …
  </div>
  <UCard v-else-if="loadError" class="m-6 max-w-md">
    <template #header>
      <h1 class="text-lg font-semibold">
        Vorgänge konnten nicht geladen werden
      </h1>
    </template>
    <p class="text-sm text-[var(--crm-ink-3)]">
      {{ loadError }}
    </p>
  </UCard>
  <UCard v-else-if="!workspaces.length" class="m-6 max-w-md">
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
  <div v-else class="flex h-full min-h-0">
    <DealList
      :deals="deals"
      :phase="phase"
      :selected-id="selected?.id ?? null"
      @phase="setPhase"
      @open="openDeal"
    />
    <DealDetail
      v-if="selected"
      :deal="selected"
      :notes="notes"
      :note-body="noteBody"
      :graph-connected="graphStatus.connected"
      :products="products"
      adresse=""
      @stufe="setStufe"
      @update:note-body="noteBody = $event"
      @save-note="addNote"
      @add="showNewDeal = true"
      @reload="reload(); loadNotes(selected.id)"
    />
    <div v-else class="flex flex-1 items-center justify-center text-[var(--crm-ink-3)]">
      Kein Vorgang ausgewählt.
    </div>
  </div>

  <UModal v-model:open="showNewDeal">
    <template #content>
      <form class="max-w-md space-y-4 p-6" @submit.prevent="submitNewDeal">
        <h2 class="text-lg font-semibold">
          Neuer Vorgang
        </h2>
        <UFormField label="Titel" required>
          <UInput v-model="newDeal.title" maxlength="200" size="lg" class="w-full" autofocus />
        </UFormField>
        <UFormField label="Wert (EUR)">
          <UInput v-model.number="newDeal.euro" type="number" min="0" step="100" placeholder="0" size="lg" class="w-full" />
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

  <ConfirmDialog
    v-model:open="confirmDelete"
    title="Vorgang löschen?"
    :consequence="`„${selected?.title}“ wird entfernt. Das lässt sich nicht rückgängig machen.`"
    @confirm="removeDeal"
  />
</template>
