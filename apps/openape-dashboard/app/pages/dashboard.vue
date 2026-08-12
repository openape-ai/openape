<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'
import { renderMarkdown } from '~/utils/markdown'

interface Kpi {
  id: string
  scope: string
  key: string
  value: number
  unit: string | null
  detail: string | null
  createdAt: number
}

const { user, fetchUser, logout } = useOpenApeAuth()

await fetchUser()
if (!user.value)
  await navigateTo('/')

const { data, pending, refresh } = await useFetch<{ kpis: Kpi[] }>('/api/kpis', {
  query: { latest: 1 },
})

const open = ref<string | null>(null)

// Group by top-level scope segment; deeper paths stay visible per row.
const groups = computed(() => {
  const map = new Map<string, Kpi[]>()
  for (const kpi of data.value?.kpis ?? []) {
    const top = kpi.scope.split('/')[0] as string
    const list = map.get(top)
    if (list)
      list.push(kpi)
    else
      map.set(top, [kpi])
  }
  return [...map.entries()]
})

function fmtValue(kpi: Kpi): string {
  const n = Number.isInteger(kpi.value) ? String(kpi.value) : kpi.value.toFixed(2)
  return kpi.unit ? `${n} ${kpi.unit}` : n
}

function fmtAge(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000)
  if (min < 60)
    return `${min} min`
  if (min < 60 * 24)
    return `${Math.round(min / 60)} h`
  return `${Math.round(min / 60 / 24)} d`
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2 font-semibold">
        <span aria-hidden="true">📊</span> OpenApe Dashboard
      </div>
      <div class="flex items-center gap-3 text-sm text-zinc-400">
        <span>{{ user?.sub }}</span>
        <UButton size="xs" variant="ghost" icon="i-lucide-refresh-cw" :loading="pending" @click="refresh()" />
        <UButton size="xs" variant="ghost" icon="i-lucide-log-out" @click="logout()" />
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-4 py-8">
      <div v-if="!groups.length" class="text-center text-zinc-500 py-16">
        <p class="text-lg">
          No KPIs yet.
        </p>
        <p class="mt-2 text-sm">
          Push your first one: <code class="text-zinc-300">ape-kpi push demo.test 1 --scope general</code>
        </p>
      </div>

      <section v-for="[top, list] in groups" :key="top" class="mb-8">
        <h2 class="text-sm uppercase tracking-wide text-zinc-500 mb-2">
          {{ top }}
        </h2>
        <ul class="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
          <li v-for="kpi in list" :key="kpi.id" class="px-4 py-3">
            <div class="flex items-baseline justify-between gap-4">
              <div class="min-w-0">
                <span class="font-medium">{{ kpi.key }}</span>
                <span v-if="kpi.scope.includes('/')" class="ml-2 text-xs text-zinc-500">{{ kpi.scope }}</span>
              </div>
              <div class="flex items-baseline gap-3 shrink-0">
                <span class="text-xl font-semibold tabular-nums">{{ fmtValue(kpi) }}</span>
                <span class="text-xs text-zinc-500">{{ fmtAge(kpi.createdAt) }}</span>
                <UButton
                  v-if="kpi.detail"
                  size="xs"
                  variant="ghost"
                  :icon="open === kpi.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  @click="open = open === kpi.id ? null : kpi.id"
                />
              </div>
            </div>
            <!-- eslint-disable-next-line vue/no-v-html — sanitized in renderMarkdown -->
            <div v-if="open === kpi.id && kpi.detail" class="prose prose-invert prose-sm mt-3 max-w-none" v-html="renderMarkdown(kpi.detail)" />
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
