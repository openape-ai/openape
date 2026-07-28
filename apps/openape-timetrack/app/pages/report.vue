<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser } = useOpenApeAuth()

interface Report {
  by: string
  total_minutes: number
  billable_minutes: number
  break_minutes: number
  groups: Array<{ key: string, label: string, total_minutes: number, billable_minutes: number, break_minutes: number, entries: number }>
}

const by = ref<'project' | 'type' | 'user' | 'day'>('project')
const from = ref('')
const to = ref('')
const data = ref<Report | null>(null)
const loading = ref(false)
const error = ref('')
const BY = ['project', 'type', 'user', 'day']

function fmt(min: number) {
  const h = Math.floor(min / 60); const m = min % 60
  return `${h}h${String(m).padStart(2, '0')}m`
}

onMounted(async () => {
  await fetchUser()
  if (!user.value) { await navigateTo('/login'); return }
  await load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const query: Record<string, string> = { by: by.value }
    if (from.value) query.from = from.value
    if (to.value) query.to = to.value
    data.value = await ($fetch as any)('/api/report', { query }) as Report
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Failed to load report'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 pb-24">
    <div class="max-w-2xl mx-auto px-4 pt-6">
      <NuxtLink to="/companies" class="text-sm text-zinc-500 hover:text-primary-500">
        ← Companies
      </NuxtLink>
      <h1 class="text-2xl font-bold mt-2 mb-6">
        Report
      </h1>

      <div class="flex flex-wrap gap-2 mb-6">
        <USelect v-model="by" :items="BY" size="lg" class="w-32" @change="load" />
        <UInput v-model="from" type="date" size="lg" placeholder="from" @change="load" />
        <UInput v-model="to" type="date" size="lg" placeholder="to" @change="load" />
      </div>

      <div v-if="loading" class="text-center text-zinc-500 mt-10">
        Loading…
      </div>
      <UAlert v-else-if="error" color="error" :title="error" />
      <template v-else-if="data">
        <div class="rounded-lg bg-zinc-900/60 p-4 mb-6">
          <div class="text-3xl font-bold tabular-nums">
            {{ fmt(data.total_minutes) }}
          </div>
          <div class="text-sm text-zinc-400">
            billable {{ fmt(data.billable_minutes) }}
            <span v-if="data.break_minutes"> · pause {{ fmt(data.break_minutes) }}</span>
          </div>
        </div>
        <ul class="divide-y divide-zinc-900">
          <li v-for="g in data.groups" :key="g.key" class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1 truncate text-sm">
              {{ g.label }}
            </div>
            <div class="tabular-nums font-semibold">
              {{ fmt(g.total_minutes) }}
            </div>
            <div class="tabular-nums text-xs text-zinc-500 w-24 text-right">
              bill {{ fmt(g.billable_minutes) }}
            </div>
          </li>
        </ul>
        <p v-if="data.groups.length === 0" class="text-center py-8 text-zinc-500">
          No entries in range.
        </p>
      </template>
    </div>
  </div>
</template>
