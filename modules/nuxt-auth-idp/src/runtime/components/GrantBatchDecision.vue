<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { GrantWithCard } from '../utils/grant-card'
import { formatRequesterName } from '../utils/command-display'
import { grantBatchInfo, grantBatchOperations, grantBatchRows, grantBatchScope, grantBatchSections } from '../utils/grant-batch'
import GrantBatchMemberRow from './GrantBatchMemberRow.vue'

const props = defineProps<{ requester: string, batchId: string }>()

const members = ref<GrantWithCard[]>([])
const selected = ref<Set<string>>(new Set())
const loading = ref(true)
const processing = ref(false)
const error = ref('')
const failures = ref<Record<string, string>>({})
const german = ref(false)
const nowSec = ref(Math.floor(Date.now() / 1000))
let clock: ReturnType<typeof setInterval> | undefined

const sections = computed(() => grantBatchSections(grantBatchRows(members.value, german.value ? 'de' : 'en')))
const info = computed(() => grantBatchInfo(members.value))
const scope = computed(() => grantBatchScope(members.value))
const decidable = computed(() => sections.value.open)
const selectedCount = computed(() => decidable.value.filter(row => selected.value.has(row.id)).length)
const allSelected = computed(() => decidable.value.length > 0 && selectedCount.value === decidable.value.length)
// grants.md §3.4: after waits_until an approval can no longer make the action happen.
const stopped = computed(() => info.value.waitsUntil !== null && nowSec.value >= info.value.waitsUntil)

const text = computed(() => german.value
  ? { heading: 'Sammelfreigabe', scope: (target: string, audience: string) => `Einmalige Freigaben für ${target} · ${audience}`, separate: 'Einzeln prüfen', quoted: (value: string) => `„${value}“`, by: 'angefragt von', own: 'Beschreibung des Anfragenden', received: (n: number, size: number) => `${n} von ${size} Anfragen eingegangen`, missing: (n: number) => `${n} Anfragen fehlen noch. Eine Entscheidung gilt nur für die angezeigten.`, notice: 'Jede Zeile zeigt, was die Freigabe bindet; Angaben des Anfragenden sind gekennzeichnet. „Details“ zeigt die ganze Anfrage.', all: 'Alle auswählen', history: (n: number) => `Bereits entschieden (${n})`, approve: (n: number, m: number) => m ? `${n} ausgewählte freigeben, ${m} ablehnen` : `${n} freigeben`, deny: 'Alle ablehnen', stopped: 'Der Anfragende wartet nicht mehr. Eine Freigabe hätte keine Wirkung mehr.', done: 'Keine offene Anfrage in diesem Batch.', empty: 'Keine Anfragen zu diesem Batch gefunden.', failed: 'Entscheidung fehlgeschlagen', language: 'English', status: { approved: 'freigegeben', denied: 'abgelehnt', revoked: 'widerrufen', expired: 'abgelaufen', used: 'verwendet', pending: 'offen' } as Record<string, string> }
  : { heading: 'Batch approval', scope: (target: string, audience: string) => `Single-use approvals for ${target} · ${audience}`, separate: 'Review individually', quoted: (value: string) => `"${value}"`, by: 'requested by', own: 'requester\'s description', received: (n: number, size: number) => `${n} of ${size} requests received`, missing: (n: number) => `${n} requests have not arrived. A decision covers only the requests shown.`, notice: 'Each row shows what the approval binds; the requester\'s own descriptions are labeled. "Details" shows the full request.', all: 'Select all', history: (n: number) => `Already decided (${n})`, approve: (n: number, m: number) => m ? `Approve ${n} selected, deny ${m}` : `Approve ${n}`, deny: 'Deny all', stopped: 'The requester has stopped waiting. An approval would have no effect.', done: 'No open request in this batch.', empty: 'No requests found for this batch.', failed: 'Decision failed', language: 'Deutsch', status: { approved: 'approved', denied: 'denied', revoked: 'revoked', expired: 'expired', used: 'used', pending: 'pending' } as Record<string, string> })

async function load() {
  loading.value = true
  error.value = ''
  try {
    const page = await $fetch<{ data: GrantWithCard[] }>('/api/grants', { query: { requester: props.requester, batch: props.batchId, limit: 100 } })
    members.value = page.data
    selected.value = new Set(page.data.filter(grant => grant.status === 'pending').map(grant => grant.id))
  }
  catch (err) {
    error.value = (err as { data?: { statusMessage?: string }, message?: string }).data?.statusMessage ?? (err as Error).message ?? 'Batch not found'
  }
  finally {
    loading.value = false
  }
}

function toggle(id: string, checked: boolean) {
  const next = new Set(selected.value)
  if (checked) next.add(id)
  else next.delete(id)
  selected.value = next
}

function toggleAll(checked: boolean) {
  selected.value = new Set(checked ? decidable.value.map(row => row.id) : [])
}

async function decide(approveSelected: boolean) {
  processing.value = true
  error.value = ''
  failures.value = {}
  try {
    const operations = grantBatchOperations(decidable.value, approveSelected ? selected.value : new Set())
    const result = await $fetch<{ results: { id: string, success: boolean, error?: { title?: string } }[] }>('/api/grants/batch', { method: 'POST', body: { operations } })
    failures.value = Object.fromEntries(result.results.filter(item => !item.success).map(item => [item.id, item.error?.title ?? text.value.failed]))
    await load()
  }
  catch (err) {
    error.value = (err as { data?: { statusMessage?: string } }).data?.statusMessage ?? text.value.failed
  }
  finally {
    processing.value = false
  }
}

onMounted(async () => {
  german.value = navigator.language.startsWith('de')
  clock = setInterval(() => { nowSec.value = Math.floor(Date.now() / 1000) }, 1000)
  await load()
})
onUnmounted(() => clearInterval(clock))
</script>

<template>
  <div class="min-h-screen flex items-start sm:items-center justify-center p-4">
    <UCard class="w-full max-w-2xl">
      <template #header>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="text-2xl font-bold">
              {{ text.heading }}
            </h1>
            <p class="text-sm text-muted break-words">
              {{ text.by }} <span class="font-semibold">{{ formatRequesterName(requester) }}</span>
            </p>
          </div>
          <button type="button" class="text-xs underline shrink-0" @click="german = !german">
            {{ text.language }}
          </button>
        </div>
      </template>

      <div v-if="loading && !members.length" class="text-center text-muted">
        Loading...
      </div>
      <div v-else class="space-y-4">
        <UAlert v-if="error" color="error" :title="error" />
        <p v-if="!members.length && !error" class="text-muted">
          {{ text.empty }}
        </p>
        <template v-if="members.length">
          <p v-if="info.title" class="text-sm break-words">
            <span class="text-muted">{{ text.own }}:</span> <span class="font-semibold">{{ text.quoted(info.title) }}</span>
          </p>
          <p v-if="scope" class="text-sm break-words" data-batch-scope>
            {{ text.scope(scope.targetHost, scope.audience) }}
          </p>
          <p v-if="info.size" class="text-sm text-muted" data-batch-received>
            {{ text.received(members.length, info.size) }}
          </p>
          <UAlert v-if="info.missing" color="warning" :title="text.missing(info.missing)" />
          <UAlert v-if="stopped && decidable.length" color="warning" :title="text.stopped" />
          <p class="text-xs text-muted">
            {{ text.notice }}
          </p>

          <label v-if="decidable.length" class="flex items-center gap-3 border-b border-default pb-2 text-sm font-medium">
            <input type="checkbox" class="size-4 shrink-0" :checked="allSelected" :disabled="processing" @change="toggleAll(($event.target as HTMLInputElement).checked)">
            {{ text.all }}
          </label>
          <ul v-if="decidable.length" class="divide-y divide-default" data-batch-rows>
            <GrantBatchMemberRow v-for="row in decidable" :key="row.id" :row="row" :german="german" :input-id="`batch-${row.id}`" :failure="failures[row.id]">
              <input
                :id="`batch-${row.id}`"
                type="checkbox"
                class="mt-1 size-4 shrink-0"
                :checked="selected.has(row.id)"
                :disabled="processing"
                @change="toggle(row.id, ($event.target as HTMLInputElement).checked)"
              >
            </GrantBatchMemberRow>
          </ul>
          <ul v-if="sections.separate.length" class="divide-y divide-default" data-batch-separate>
            <GrantBatchMemberRow v-for="row in sections.separate" :key="row.id" :row="row" :german="german" :failure="failures[row.id]">
              <span class="mt-0.5 w-24 shrink-0 rounded border border-default px-1.5 text-center text-xs text-muted">{{ text.separate }}</span>
            </GrantBatchMemberRow>
          </ul>

          <p v-if="!decidable.length && !sections.separate.length" class="text-sm text-muted">
            {{ text.done }}
          </p>
          <div v-if="decidable.length" class="sticky bottom-0 flex flex-col sm:flex-row gap-2 bg-default pt-2">
            <UButton color="primary" class="justify-center" :loading="processing" :disabled="processing || stopped || !selectedCount" @click="decide(true)">
              {{ text.approve(selectedCount, decidable.length - selectedCount) }}
            </UButton>
            <UButton color="error" variant="outline" class="justify-center" :disabled="processing" @click="decide(false)">
              {{ text.deny }}
            </UButton>
          </div>

          <details v-if="sections.decided.length" class="border-t border-default pt-3" data-batch-history>
            <summary class="cursor-pointer text-sm text-muted">
              {{ text.history(sections.decided.length) }}
            </summary>
            <ul class="mt-2 divide-y divide-default">
              <GrantBatchMemberRow v-for="row in sections.decided" :key="row.id" :row="row" :german="german" :failure="failures[row.id]" :status="text.status[row.status] ?? row.status" />
            </ul>
          </details>
        </template>
      </div>
    </UCard>
  </div>
</template>
