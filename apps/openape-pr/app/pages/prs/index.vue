<script setup lang="ts">
import { useOpenApeAuth } from '#imports'

interface PrListItem {
  id: string
  title: string
  author: string | null
  branch: string | null
  status: 'pending' | 'reviewed'
  files: number
  additions: number
  deletions: number
  created_by_act: 'human' | 'agent'
  created_at: number
}

const { user, fetchUser, logout } = useOpenApeAuth()

const { data: prs } = await useFetch<PrListItem[]>('/api/prs', { server: false })

onMounted(async () => {
  await fetchUser()
  if (!user.value) await navigateTo('/')
})

const STATUS_COLOR = { pending: 'warning', reviewed: 'success' } as const

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

async function onLogout() {
  await logout()
  await navigateTo('/')
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800/80">
      <div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <NuxtLink to="/prs" class="font-semibold tracking-tight">
          🔍 OpenApe <span class="text-primary-500">PR</span>
        </NuxtLink>
        <div class="flex items-center gap-3 text-sm text-zinc-400">
          <span v-if="user">{{ user.sub }}</span>
          <UButton variant="ghost" color="neutral" size="sm" @click="onLogout">
            Logout
          </UButton>
        </div>
      </div>
    </header>

    <main class="max-w-4xl mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">
        Pull requests
      </h1>

      <div v-if="!prs?.length" class="text-center py-16 text-zinc-500">
        <p class="text-lg">
          No pull requests yet.
        </p>
        <p class="mt-2 text-sm">
          Upload one: <code class="text-zinc-300">ape-pr upload ./out</code>
        </p>
      </div>

      <ul v-else class="space-y-3">
        <li
          v-for="pr in prs"
          :key="pr.id"
          class="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 px-4 py-3 flex items-center gap-4"
        >
          <UBadge :color="STATUS_COLOR[pr.status]" variant="subtle" class="uppercase shrink-0">
            {{ pr.status }}
          </UBadge>
          <div class="min-w-0 flex-1">
            <NuxtLink :to="`/prs/${pr.id}`" class="font-medium hover:text-primary-400 transition-colors block truncate">
              {{ pr.title }}
            </NuxtLink>
            <p class="text-xs text-zinc-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span v-if="pr.branch" class="font-mono">{{ pr.branch }}</span>
              <span>{{ pr.files }} file{{ pr.files === 1 ? '' : 's' }}</span>
              <span class="text-emerald-500">+{{ pr.additions }}</span>
              <span class="text-rose-500">−{{ pr.deletions }}</span>
              <span>· {{ fmtDate(pr.created_at) }}</span>
              <span v-if="pr.author">· {{ pr.author }}</span>
              <span v-if="pr.created_by_act === 'agent'">· 🤖 agent</span>
            </p>
          </div>
          <UIcon name="i-lucide-chevron-right" class="text-zinc-600 shrink-0" />
        </li>
      </ul>
    </main>
  </div>
</template>
