<script setup lang="ts">
import { useOpenApeAuth } from '#imports'

interface Kpi {
  id: string
  scope: string
  key: string
  value: number
  unit: string | null
  detail: string | null
  link: string | null
  createdAt: number
}

const { user, fetchUser, logout } = useOpenApeAuth()

await fetchUser()
if (!user.value)
  await navigateTo('/')

const { data, pending, refresh } = await useFetch<{ kpis: Kpi[] }>('/api/kpis', {
  query: { latest: 1 },
})
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
      <div class="flex items-center gap-2 font-semibold">
        <span aria-hidden="true">📊</span> OpenApe Dashboard
      </div>
      <div class="flex items-center gap-3 text-sm text-zinc-400">
        <span>{{ user?.sub }}</span>
        <UButton size="xs" variant="ghost" icon="i-lucide-refresh-cw" :loading="pending" aria-label="Aktualisieren" @click="refresh()" />
        <UButton size="xs" variant="ghost" icon="i-lucide-log-out" aria-label="Abmelden" @click="logout()" />
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-4 py-8">
      <KpiBoard :kpis="data?.kpis ?? []" />
    </main>
  </div>
</template>
