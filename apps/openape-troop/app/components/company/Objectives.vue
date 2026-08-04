<script setup lang="ts">
import { useOrgCrud } from '../../composables/useOrgCrud'

// Objectives board (B0 merge). Owner authors what the company works on; the Operator
// reads + drives against it. Flat list grouped by status — no nesting yet.
const props = defineProps<{ orgId: string }>()

interface Objective { id: string, title: string, description: string, status: string, targetDate: number | null }

const COLUMNS = [
  { key: 'planned', label: 'Geplant' },
  { key: 'in_progress', label: 'In Arbeit' },
  { key: 'done', label: 'Erledigt' },
] as const

const { items, loading, error, busy, saving, formError, form, submit, patch, remove } = useOrgCrud<Objective, { title: string }>({
  collection: () => `/api/orgs/${props.orgId}/objectives`,
  emptyForm: () => ({ title: '' }),
})

function byStatus(s: string) { return items.value.filter(o => o.status === s) }

async function add() {
  if (!form.title.trim()) return
  const created = await submit({ title: form.title.trim() })
  if (created) form.title = ''
}
</script>

<template>
  <div>
    <div class="flex gap-2 mb-6">
      <UInput v-model="form.title" placeholder="Neues Ziel …" class="flex-1" :ui="{ base: 'w-full' }" @keydown.enter="add" />
      <UButton color="primary" icon="i-lucide-plus" :loading="saving" :disabled="!form.title.trim()" @click="add">
        Ziel
      </UButton>
    </div>

    <UAlert v-if="error || formError" color="error" variant="subtle" :title="error || formError" class="mb-4" />

    <div v-if="loading" class="text-zinc-500 py-10 text-center">
      Lädt …
    </div>
    <div v-else class="grid gap-4 md:grid-cols-3">
      <div v-for="col in COLUMNS" :key="col.key">
        <h4 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          {{ col.label }} <span class="text-zinc-600">({{ byStatus(col.key).length }})</span>
        </h4>
        <div class="space-y-2">
          <div
            v-for="o in byStatus(col.key)"
            :key="o.id"
            class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="text-sm">{{ o.title }}</span>
              <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :loading="busy[o.id]" @click="remove(o.id)" />
            </div>
            <div class="flex gap-1 mt-2">
              <UButton v-if="col.key !== 'planned'" color="neutral" variant="soft" size="xs" icon="i-lucide-chevron-left" :loading="busy[o.id]" @click="patch(o.id, { status: col.key === 'done' ? 'in_progress' : 'planned' })" />
              <UButton v-if="col.key !== 'done'" color="neutral" variant="soft" size="xs" icon="i-lucide-chevron-right" :loading="busy[o.id]" @click="patch(o.id, { status: col.key === 'planned' ? 'in_progress' : 'done' })" />
            </div>
          </div>
          <p v-if="!byStatus(col.key).length" class="text-xs text-zinc-600 italic px-1">
            —
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
