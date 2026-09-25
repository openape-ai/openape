<script setup lang="ts">
import { computed } from 'vue'
import { issueError } from '~/utils/issue-ui'
import { cloneCommand } from '~/utils/git-ui'

const route = useRoute()
const owner = route.params.owner as string
const name = route.params.name as string

const ready = ref(false)
const error = ref('')

const clone = computed(() =>
  cloneCommand(typeof window === 'undefined' ? 'repos.openape.ai' : window.location.origin, owner, name))

onMounted(async () => {
  try {
    if (useRuntimeConfig().public.issuesEnabled) {
      const metadata = await $fetch<{ issueHomeOnly: number }>(`/api/repos/${owner}/${name}/metadata`)
      if (metadata.issueHomeOnly) { await navigateTo(`/${owner}/${name}/issues`, { replace: true }); return }
    }
    ready.value = true
  }
  catch (err) { error.value = issueError(err) }
})
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader :owner="owner" :name="name" tab="code" />

    <UAlert v-if="error" role="alert" color="error" :title="error" />
    <main v-if="ready" class="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <RepoBrowse :owner="owner" :name="name" path="" />

      <section>
        <code class="block bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-sm overflow-x-auto whitespace-nowrap">
          {{ clone }}
        </code>
      </section>
    </main>
  </div>
</template>
