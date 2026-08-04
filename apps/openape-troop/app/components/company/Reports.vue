<script setup lang="ts">
import { ref } from 'vue'
import { useOrgCrud } from '../../composables/useOrgCrud'

// Reports inbox (B0 merge). Newest first. Operator/Sanierer write weekly/alert
// reports here (M1+); the Owner can also hand-author. This is Patrick's
// steering cockpit — the company reporting up to him.
const props = defineProps<{ orgId: string }>()

interface Report { id: string, kind: string, title: string, bodyMd: string, createdAt: number }

const expanded = ref<string | null>(null)

const { items, loading, error, showForm, saving, formError, form, submit } = useOrgCrud<Report, { kind: string, title: string, body: string }>({
  collection: () => `/api/orgs/${props.orgId}/reports`,
  emptyForm: () => ({ kind: 'adhoc', title: '', body: '' }),
})

const KINDS = [
  { label: 'Ad-hoc', value: 'adhoc' },
  { label: 'Täglich', value: 'daily' },
  { label: 'Wöchentlich', value: 'weekly' },
  { label: 'Quartal', value: 'quarterly' },
  { label: 'Alarm', value: 'alert' },
]
function kindColor(k: string) { return k === 'alert' ? 'error' : k === 'weekly' || k === 'quarterly' ? 'primary' : 'neutral' }
function fmtDate(s: number) { return new Date(s * 1000).toLocaleDateString('de-AT', { day: '2-digit', month: 'short', year: 'numeric' }) }

async function save() {
  if (!form.title.trim() || !form.body.trim()) return
  const created = await submit({ kind: form.kind, title: form.title.trim(), body_md: form.body.trim() })
  if (created) {
    form.title = ''
    form.body = ''
  }
}
</script>

<template>
  <div>
    <div class="flex justify-end mb-4">
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-pencil" @click="showForm = !showForm">
        Report schreiben
      </UButton>
    </div>

    <div v-if="showForm" class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-6 space-y-3">
      <div class="flex gap-2">
        <USelect v-model="form.kind" :items="KINDS" class="w-40" />
        <UInput v-model="form.title" placeholder="Titel" class="flex-1" :ui="{ base: 'w-full' }" />
      </div>
      <UTextarea v-model="form.body" placeholder="Inhalt (Markdown)" :rows="5" class="w-full" :ui="{ base: 'w-full' }" />
      <UAlert v-if="formError" color="error" variant="subtle" :title="formError" />
      <div class="flex justify-end">
        <UButton color="primary" size="sm" :loading="saving" :disabled="!form.title.trim() || !form.body.trim()" @click="save">
          Speichern
        </UButton>
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />

    <div v-if="loading" class="text-zinc-500 py-10 text-center">
      Lädt …
    </div>
    <p v-else-if="!items.length" class="text-zinc-500 py-10 text-center">
      Noch keine Reports.
    </p>
    <div v-else class="space-y-2">
      <div
        v-for="r in items"
        :key="r.id"
        class="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden"
      >
        <button class="w-full text-left p-4 flex items-center justify-between gap-3" @click="expanded = expanded === r.id ? null : r.id">
          <div class="flex items-center gap-3 min-w-0">
            <UBadge :color="kindColor(r.kind)" variant="subtle" size="sm">
              {{ r.kind }}
            </UBadge>
            <span class="font-medium truncate">{{ r.title }}</span>
          </div>
          <span class="text-xs text-zinc-500 shrink-0">{{ fmtDate(r.createdAt) }}</span>
        </button>
        <div v-if="expanded === r.id" class="px-4 pb-4 text-sm text-zinc-300 border-t border-zinc-800/60 pt-3">
          <MarkdownText :content="r.bodyMd" />
        </div>
      </div>
    </div>
  </div>
</template>
