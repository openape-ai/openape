<script setup lang="ts">
import { useOpenApeAuth } from '#imports'

interface RunListItem {
  id: string
  slug: string
  url: string
  title: string
  project: string | null
  status: 'passed' | 'failed' | 'skipped'
  passed: number
  failed: number
  skipped: number
  created_by_act: 'human' | 'agent'
  created_at: number
}

const { user, fetchUser, logout } = useOpenApeAuth()
const toast = useToast()

const { data: runs, refresh } = await useFetch<RunListItem[]>('/api/runs', { server: false })

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
  }
})

const STATUS_COLOR = { passed: 'success', failed: 'error', skipped: 'neutral' } as const

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

async function copyLink(run: RunListItem) {
  await navigator.clipboard.writeText(run.url)
  toast.add({ title: 'Link copied', description: run.url, color: 'success' })
}

async function removeRun(run: RunListItem) {
  if (!confirm(`Delete run "${run.title}"? The share link stops working.`)) return
  await $fetch(`/api/runs/${run.id}`, { method: 'DELETE' })
  await refresh()
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
        <NuxtLink to="/" class="font-semibold tracking-tight">
          🧪 OpenApe <span class="text-primary-500">Testrun</span>
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
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">
          Your test runs
        </h1>
      </div>

      <div v-if="!runs?.length" class="text-center py-16 text-zinc-500">
        <p class="text-lg">
          No runs yet.
        </p>
        <p class="mt-2 text-sm">
          Upload your first run: <code class="text-zinc-300">ape-testruns upload ./out --title "My E2E run"</code>
        </p>
      </div>

      <ul v-else class="space-y-3">
        <li
          v-for="run in runs"
          :key="run.id"
          class="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 px-4 py-3 flex items-center gap-4"
        >
          <UBadge :color="STATUS_COLOR[run.status]" variant="subtle" class="uppercase shrink-0">
            {{ run.status }}
          </UBadge>
          <div class="min-w-0 flex-1">
            <NuxtLink :to="`/r/${run.slug}`" class="font-medium hover:text-primary-400 transition-colors block truncate">
              {{ run.title }}
            </NuxtLink>
            <p class="text-xs text-zinc-500 mt-0.5">
              <span v-if="run.project">{{ run.project }} · </span>
              {{ run.passed }} passed · {{ run.failed }} failed<span v-if="run.skipped"> · {{ run.skipped }} skipped</span>
              · {{ fmtDate(run.created_at) }}
              <span v-if="run.created_by_act === 'agent'"> · 🤖 agent</span>
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <UButton icon="i-lucide-link" variant="ghost" color="neutral" size="sm" title="Copy share link" @click="copyLink(run)" />
            <UButton icon="i-lucide-trash-2" variant="ghost" color="neutral" size="sm" title="Delete run" @click="removeRun(run)" />
          </div>
        </li>
      </ul>
    </main>
  </div>
</template>
