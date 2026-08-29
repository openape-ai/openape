<script setup lang="ts">
import { ref } from 'vue'
import { statusLook } from '~/utils/git-ui'
import { formatDate, shortSha } from '~/utils/repo-browse'

interface CommitStatus {
  id: string
  context: string
  state: 'pending' | 'success' | 'failure'
  description: string | null
  targetUrl: string | null
  log: string | null
  createdAt: number
}

const route = useRoute()
const owner = route.params.owner as string
const name = route.params.name as string
const sha = route.params.sha as string

const statuses = ref<CommitStatus[]>([])
const error = ref('')

onMounted(async () => {
  try {
    const data = await $fetch<{ statuses: CommitStatus[] }>(`/api/repos/${owner}/${name}/statuses/${sha}`)
    statuses.value = data.statuses
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    error.value = e.data?.statusMessage ?? 'Failed to load checks.'
  }
})
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader :owner="owner" :name="name" tab="commits" />

    <main class="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <UAlert v-if="error" color="error" :title="error" />

      <h1 class="text-lg font-semibold">
        Checks for <code class="font-mono text-amber-500">{{ shortSha(sha) }}</code>
      </h1>

      <p v-if="statuses.length === 0 && !error" class="text-zinc-500">
        No CI consumer has reported a result for this commit.
      </p>

      <section
        v-for="status in statuses"
        :key="status.id"
        class="border border-zinc-800 rounded-lg overflow-hidden"
      >
        <div class="flex items-center gap-2 px-4 py-3 bg-zinc-900/60">
          <UIcon :name="statusLook(status.state).icon" :class="statusLook(status.state).class" class="size-4" />
          <span class="font-medium">{{ status.context }}</span>
          <span class="text-sm text-zinc-500">{{ status.description }}</span>
          <span class="text-xs text-zinc-600 ml-auto">{{ formatDate(status.createdAt) }}</span>
        </div>
        <pre v-if="status.log" class="px-4 py-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto text-zinc-300">{{ status.log }}</pre>
      </section>
    </main>
  </div>
</template>
