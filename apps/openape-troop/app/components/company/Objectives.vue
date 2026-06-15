<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

// Objectives board (B0 merge). Owner authors what the company works on; the CEO
// reads + drives against it. Flat list grouped by status — no nesting yet.
const props = defineProps<{ orgId: string }>()

interface Objective { id: string, title: string, description: string, status: string, targetDate: number | null }

const COLUMNS = [
  { key: 'planned', label: 'Geplant' },
  { key: 'in_progress', label: 'In Arbeit' },
  { key: 'done', label: 'Erledigt' },
] as const

const items = ref<Objective[]>([])
const loading = ref(true)
const newTitle = ref('')
const adding = ref(false)
const busy = reactive<Record<string, boolean>>({})

async function load() {
  loading.value = true
  items.value = await ($fetch as any)(`/api/orgs/${props.orgId}/objectives`)
  loading.value = false
}
function byStatus(s: string) { return items.value.filter(o => o.status === s) }

async function add() {
  if (!newTitle.value.trim()) return
  adding.value = true
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/objectives`, { method: 'POST', body: { title: newTitle.value.trim() } })
    newTitle.value = ''
    await load()
  }
  finally { adding.value = false }
}
async function setStatus(o: Objective, status: string) {
  busy[o.id] = true
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/objectives/${o.id}`, { method: 'PATCH', body: { status } })
    await load()
  }
  finally { busy[o.id] = false }
}
async function remove(o: Objective) {
  busy[o.id] = true
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/objectives/${o.id}`, { method: 'DELETE' })
    await load()
  }
  finally { busy[o.id] = false }
}

watch(() => props.orgId, load, { immediate: true })
</script>

<template>
  <div>
    <div class="flex gap-2 mb-6">
      <UInput v-model="newTitle" placeholder="Neues Ziel …" class="flex-1" :ui="{ base: 'w-full' }" @keydown.enter="add" />
      <UButton color="primary" icon="i-lucide-plus" :loading="adding" :disabled="!newTitle.trim()" @click="add">
        Ziel
      </UButton>
    </div>

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
              <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :loading="busy[o.id]" @click="remove(o)" />
            </div>
            <div class="flex gap-1 mt-2">
              <UButton v-if="col.key !== 'planned'" color="neutral" variant="soft" size="xs" icon="i-lucide-chevron-left" :loading="busy[o.id]" @click="setStatus(o, col.key === 'done' ? 'in_progress' : 'planned')" />
              <UButton v-if="col.key !== 'done'" color="neutral" variant="soft" size="xs" icon="i-lucide-chevron-right" :loading="busy[o.id]" @click="setStatus(o, col.key === 'planned' ? 'in_progress' : 'done')" />
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
