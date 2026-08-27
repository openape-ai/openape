<script setup lang="ts">
import type { Phase } from '#shared/pipelines'
import type { Deal } from '../utils/board'
import type { WizardLine, WizardProduct } from './OfferWizard.vue'
import { computed, ref, watch } from 'vue'
import { PIPELINES } from '#shared/pipelines'
import { formatEuro } from '../utils/board'
import { apiFetch } from '../utils/api'

interface Note { id: string, kind: string, title: string, body: string, author_email: string, created_at: number }
interface Contract {
  id: string
  status: string
  offer_number: string
  art: string
  wert: number
  currency: string
  ende: string | null
  web_url: string | null
}
interface Task { id: string, title: string, status: string, due_at: string | null, assignee_email: string }
interface FileRow { id: string, name: string, web_url: string }

const props = defineProps<{
  deal: Deal
  notes: Note[]
  noteBody: string
  graphConnected: boolean
  products: WizardProduct[]
  adresse: string
}>()
const emit = defineEmits<{
  stufe: [id: string]
  'update:noteBody': [value: string]
  saveNote: []
  add: []
  reload: []
}>()

const { run } = useApiAction()
const pipe = computed(() => PIPELINES[props.deal.phase as Phase] ?? PIPELINES.deal)
const pill = computed(() => ({ lead: 'amber', deal: 'cyan', kunde: 'lime' }[props.deal.phase as Phase] ?? 'cyan'))
const contracts = ref<Contract[]>([])
const dealTasks = ref<Task[]>([])
const files = ref<FileRow[]>([])
const folderUrl = ref<string | null>(null)
const wizardOpen = ref(false)
const mailOpen = ref(false)
const meetingOpen = ref(false)
const mail = ref({ to: '', subject: '', body: '' })
const meeting = ref({ subject: '', start: '', end: '' })
const newTask = ref('')

watch(() => props.deal.id, () => {
  void loadExtras()
  mail.value.to = props.deal.people.find(p => p.email)?.email || ''
}, { immediate: true })
watch(() => props.graphConnected, (connected, was) => {
  if (connected && !was) void loadExtras()
})

async function loadExtras() {
  try {
    const [c, t, f] = await Promise.all([
      apiFetch<Contract[]>(`/api/contracts?deal_id=${props.deal.id}`),
      apiFetch<Task[]>(`/api/tasks?deal_id=${props.deal.id}`),
      apiFetch<{ folder_web_url: string | null, files: FileRow[] }>(`/api/deals/${props.deal.id}/files`),
    ])
    contracts.value = c
    dealTasks.value = t
    files.value = f.files
    folderUrl.value = f.folder_web_url
  }
  catch {
    contracts.value = []
    dealTasks.value = []
    files.value = []
    folderUrl.value = null
  }
}

async function sendOffer(payload: {
  to: string
  start_date: string
  minimum_term_months: number | null
  currency: string
  conditions: string
  positionen: WizardLine[]
}) {
  const created = await run(
    () => apiFetch(`/api/deals/${props.deal.id}/offers`, {
      method: 'POST',
      body: {
        ...payload,
        positionen: payload.positionen.map(p => ({
          product_id: p.product_id,
          name: props.products.find(x => x.id === p.product_id)?.name,
          price_cents: p.price_cents,
          discount_cents: p.discount_cents,
          billing: p.billing,
        })),
      },
    }),
    { success: 'Angebot versendet · Vertrag „offen“ angelegt', failure: 'Angebot konnte nicht versendet werden' },
  )
  if (created) {
    await loadExtras()
    emit('reload')
  }
}

async function signContract(id: string) {
  const signed = await run(
    () => apiFetch(`/api/contracts/${id}/sign`, { method: 'POST' }),
    { success: 'Signiert · Vertrag aktiv', failure: 'Signatur fehlgeschlagen' },
  )
  if (signed) {
    wizardOpen.value = false
    await loadExtras()
    emit('reload')
  }
}

async function sendMail() {
  const sent = await run(
    () => apiFetch(`/api/deals/${props.deal.id}/mail`, {
      method: 'POST',
      body: { to: mail.value.to, subject: mail.value.subject, body: mail.value.body },
    }),
    { success: 'Mail gesendet', failure: 'Mail fehlgeschlagen' },
  )
  if (sent) {
    mailOpen.value = false
    emit('reload')
  }
}

async function sendMeeting() {
  const sent = await run(
    () => apiFetch(`/api/deals/${props.deal.id}/meetings`, {
      method: 'POST',
      body: {
        ...meeting.value,
        attendees: props.deal.people.map(p => p.email).filter((e): e is string => Boolean(e)),
      },
    }),
    { success: 'Termin angelegt', failure: 'Termin fehlgeschlagen' },
  )
  if (sent) {
    meetingOpen.value = false
    emit('reload')
  }
}

async function addTask() {
  const title = newTask.value.trim()
  if (!title) return
  const created = await run(
    () => apiFetch('/api/tasks', { method: 'POST', body: { deal_id: props.deal.id, title } }),
    { success: 'Aufgabe angelegt', failure: 'Aufgabe fehlgeschlagen' },
  )
  if (created) {
    newTask.value = ''
    await loadExtras()
    emit('reload')
  }
}

async function toggleTask(task: Task) {
  await run(
    () => apiFetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      body: { status: task.status === 'offen' ? 'erledigt' : 'offen' },
    }),
    { failure: 'Aufgabe konnte nicht geändert werden' },
  )
  await loadExtras()
}

const latestOpen = computed(() => contracts.value.find(c => c.status === 'offen'))
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col overflow-auto">
    <div class="sticky top-0 z-5 bg-[var(--crm-bg)] px-[22px] pt-4">
      <div class="flex items-start">
        <div>
          <h1 class="m-0 flex items-center gap-2.5 text-[19px] font-semibold tracking-tight">
            {{ deal.org_name || deal.title }}
            <span
              class="rounded-full border px-1.5 text-[10.5px] font-normal"
              :class="{
                'border-[rgba(163,230,53,.3)] bg-[rgba(163,230,53,.08)] text-[var(--crm-lime)]': pill === 'lime',
                'border-[rgba(56,189,248,.3)] bg-[rgba(56,189,248,.08)] text-[var(--crm-cyan)]': pill === 'cyan',
                'border-[rgba(251,191,36,.3)] bg-[rgba(251,191,36,.08)] text-[var(--crm-amber)]': pill === 'amber',
              }"
            >{{ pipe.label }}</span>
          </h1>
          <div class="mt-0.5 text-[var(--crm-ink-3)]">
            {{ deal.title }}
            <template v-if="deal.people.length">
              · {{ deal.people.map(p => p.name).join(', ') }}
            </template>
            <template v-else-if="deal.contact_name">
              · {{ deal.contact_name }}
            </template>
          </div>
        </div>
        <div class="ms-auto flex gap-1.5">
          <UButton color="neutral" variant="ghost" size="sm" :disabled="!graphConnected" :title="graphConnected ? '' : 'Microsoft verbinden'" @click="mailOpen = true">
            Mail
          </UButton>
          <UButton color="neutral" variant="ghost" size="sm" :disabled="!graphConnected" :title="graphConnected ? '' : 'Microsoft verbinden'" @click="meetingOpen = true">
            Termin
          </UButton>
          <UButton size="sm" @click="wizardOpen = true">
            Angebot erstellen
          </UButton>
        </div>
      </div>
    </div>
    <PipelineTrack :phase="(deal.phase as Phase)" :stufe="deal.stufe" @select="emit('stufe', $event)" />
    <div class="grid grid-cols-[1fr_292px] gap-[18px] px-[22px] pt-[18px] pb-10">
      <div class="flex flex-col gap-3.5">
        <div class="rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-panel)]">
          <h3 class="m-0 flex items-center gap-2 border-b border-[var(--crm-line)] px-3.5 py-2.5 text-[11px] uppercase tracking-wide text-[var(--crm-ink-3)]">
            Historie
          </h3>
          <ul class="m-0 list-none px-3.5 py-1">
            <li v-for="note in notes" :key="note.id" class="border-b border-[var(--crm-line)] py-2.5 last:border-b-0">
              <div class="flex">
                <b class="font-medium">{{ note.title }}</b>
                <span class="ms-auto text-[11.5px] whitespace-nowrap text-[var(--crm-ink-3)]">
                  {{ new Date(note.created_at).toLocaleString('de-AT') }} · {{ note.author_email }}
                </span>
              </div>
              <p class="mt-1 mb-0 whitespace-pre-wrap text-[var(--crm-ink-2)]">
                {{ note.body }}
              </p>
            </li>
          </ul>
          <div class="flex gap-1.5 border-t border-[var(--crm-line)] p-2.5">
            <UInput
              :model-value="noteBody"
              class="flex-1"
              placeholder="Notiz schreiben …"
              @update:model-value="emit('update:noteBody', String($event))"
              @keydown.enter="emit('saveNote')"
            />
            <UButton size="sm" :disabled="!noteBody.trim()" @click="emit('saveNote')">
              Speichern
            </UButton>
          </div>
        </div>
        <div class="rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-panel)]">
          <h3 class="m-0 border-b border-[var(--crm-line)] px-3.5 py-2.5 text-[11px] uppercase tracking-wide text-[var(--crm-ink-3)]">
            Verträge
          </h3>
          <ul v-if="contracts.length" class="m-0 list-none px-3.5 py-2">
            <li v-for="c in contracts" :key="c.id" class="flex items-center gap-2 py-2 text-sm">
              <div>
                <b>{{ c.offer_number }}</b>
                <span class="text-[var(--crm-ink-3)]"> · {{ c.status }} · {{ c.art }} · {{ formatEuro(c.wert, c.currency) }}</span>
              </div>
              <a v-if="c.web_url" :href="c.web_url" target="_blank" class="ms-auto text-[var(--crm-accent-2)]">PDF</a>
              <UButton v-if="c.status === 'offen'" size="xs" @click="signContract(c.id)">
                Signatur simulieren
              </UButton>
            </li>
          </ul>
          <p v-else class="px-3.5 py-3 text-sm text-[var(--crm-ink-3)]">
            Noch kein Vertrag. Ein Angebot legt automatisch einen im Status „offen“ an.
          </p>
        </div>
      </div>
      <div class="flex flex-col gap-3.5">
        <div class="rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-panel)]">
          <h3 class="m-0 border-b border-[var(--crm-line)] px-3.5 py-2.5 text-[11px] uppercase tracking-wide text-[var(--crm-ink-3)]">
            Firma
          </h3>
          <div class="px-3.5 py-3 text-sm text-[var(--crm-ink-2)]">
            {{ deal.org_name || 'Keine Firma' }}
            <p v-if="adresse" class="mt-1 mb-0 text-[var(--crm-ink-3)]">
              {{ adresse }}
            </p>
          </div>
        </div>
        <div class="rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-panel)]">
          <h3 class="m-0 border-b border-[var(--crm-line)] px-3.5 py-2.5 text-[11px] uppercase tracking-wide text-[var(--crm-ink-3)]">
            Aufgaben
          </h3>
          <ul class="m-0 list-none px-3.5 py-2">
            <li v-for="task in dealTasks" :key="task.id" class="flex items-start gap-2 py-1 text-sm">
              <input type="checkbox" :checked="task.status === 'erledigt'" @change="toggleTask(task)">
              <span :class="task.status === 'erledigt' ? 'text-[var(--crm-ink-3)] line-through' : ''">{{ task.title }}</span>
            </li>
          </ul>
          <div class="flex gap-1 border-t border-[var(--crm-line)] p-2">
            <UInput v-model="newTask" class="flex-1" size="xs" placeholder="Aufgabe …" @keydown.enter="addTask" />
            <UButton size="xs" :disabled="!newTask.trim()" @click="addTask">
              +
            </UButton>
          </div>
        </div>
        <div class="rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-panel)]">
          <h3 class="m-0 border-b border-[var(--crm-line)] px-3.5 py-2.5 text-[11px] uppercase tracking-wide text-[var(--crm-ink-3)]">
            Dokumente
          </h3>
          <ul class="m-0 list-none px-3.5 py-2 text-sm">
            <li v-for="file in files" :key="file.id" class="py-1">
              <a :href="file.web_url" target="_blank" class="text-[var(--crm-accent-2)]">{{ file.name }}</a>
            </li>
          </ul>
          <p v-if="!files.length" class="px-3.5 py-2 text-sm text-[var(--crm-ink-3)]">
            {{ graphConnected ? 'Noch keine Dateien.' : 'Microsoft verbinden, um OneDrive zu nutzen.' }}
          </p>
          <a v-if="folderUrl" :href="folderUrl" target="_blank" class="block px-3.5 pb-3 text-[11.5px] text-[var(--crm-ink-3)]">
            In OneDrive öffnen
          </a>
        </div>
        <UButton icon="i-lucide-plus" @click="emit('add')">
          Neuer Vorgang
        </UButton>
      </div>
    </div>

    <OfferWizard
      :open="wizardOpen"
      :firma="deal.org_name || deal.title"
      :person="deal.people[0]?.name || deal.contact_name || ''"
      :adresse="adresse"
      :empfaenger="deal.people.find(p => p.email)?.email || ''"
      :products="products"
      :graph-connected="graphConnected"
      @update:open="wizardOpen = $event"
      @send="sendOffer"
      @sign="latestOpen && signContract(latestOpen.id)"
    />

    <UModal v-model:open="mailOpen">
      <template #content>
        <form class="max-w-md space-y-3 p-6" @submit.prevent="sendMail">
          <h2 class="text-lg font-semibold">
            Mail
          </h2>
          <UFormField label="An">
            <UInput v-model="mail.to" />
          </UFormField>
          <UFormField label="Betreff">
            <UInput v-model="mail.subject" />
          </UFormField>
          <UFormField label="Text">
            <UTextarea v-model="mail.body" :rows="6" />
          </UFormField>
          <UButton type="submit" block :disabled="!mail.to || !mail.subject || !mail.body">
            Senden
          </UButton>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="meetingOpen">
      <template #content>
        <form class="max-w-md space-y-3 p-6" @submit.prevent="sendMeeting">
          <h2 class="text-lg font-semibold">
            Termin
          </h2>
          <UFormField label="Titel">
            <UInput v-model="meeting.subject" />
          </UFormField>
          <UFormField label="Start (UTC)">
            <UInput v-model="meeting.start" placeholder="2026-09-01T10:00:00" />
          </UFormField>
          <UFormField label="Ende (UTC)">
            <UInput v-model="meeting.end" placeholder="2026-09-01T11:00:00" />
          </UFormField>
          <UButton type="submit" block :disabled="!meeting.subject || !meeting.start || !meeting.end">
            Anlegen
          </UButton>
        </form>
      </template>
    </UModal>
  </div>
</template>
