<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { issueError } from '../utils/issue-ui'

const props = defineProps<{
  owner: string
  name: string
  tab: 'code' | 'commits' | 'issues' | 'pulls' | 'settings'
}>()

const issuesEnabled = useRuntimeConfig().public.issuesEnabled
const metadata = ref<{ issueHomeOnly: number, codeSourceUrl: string | null } | null>(null)
const metadataError = ref('')
onMounted(async () => {
  if (!issuesEnabled) return
  try { metadata.value = await $fetch(`/api/repos/${props.owner}/${props.name}/metadata`) }
  catch (err) { metadataError.value = issueError(err) }
})
const tabs = computed(() => [
  ...(!issuesEnabled || metadata.value?.issueHomeOnly === 0
    ? [{ key: 'code', label: 'Code', icon: 'i-lucide-folder-git-2', to: `/${props.owner}/${props.name}` },
        { key: 'commits', label: 'Commits', icon: 'i-lucide-history', to: `/${props.owner}/${props.name}/commits` }]
    : []),
  ...(issuesEnabled ? [{ key: 'issues', label: 'Issues', icon: 'i-lucide-circle-dot', to: `/${props.owner}/${props.name}/issues` }] : []),
  ...(!issuesEnabled || metadata.value?.issueHomeOnly === 0 ? [{ key: 'pulls', label: 'Pulls', icon: 'i-lucide-git-pull-request', to: `/${props.owner}/${props.name}/pulls` }] : []),
  { key: 'settings', label: 'Access', icon: 'i-lucide-key-round', to: `/${props.owner}/${props.name}/settings` },
])
</script>

<template>
  <header class="border-b border-zinc-800 px-4 pt-3">
    <div class="flex items-center justify-between gap-3">
      <NuxtLink to="/" class="font-bold text-lg shrink-0">
        🦍 ape-git
      </NuxtLink>
      <NuxtLink v-if="issuesEnabled" to="/report?product=git" class="text-xs text-zinc-400">
        Report a problem
      </NuxtLink>
      <span class="font-mono text-sm text-zinc-400 truncate">
        {{ owner }}<span class="text-zinc-600">/</span>{{ name }}
      </span>
    </div>
    <p v-if="metadata?.issueHomeOnly" class="text-sm text-zinc-400 mt-3">
      Development issues · <a :href="metadata.codeSourceUrl!" rel="noopener noreferrer" class="text-amber-400 hover:underline">View external code</a>
    </p>
    <p v-if="metadataError" role="alert" class="text-sm text-red-400 mt-3">
      {{ metadataError }}
    </p>
    <nav class="flex gap-1 mt-2 -mb-px overflow-x-auto">
      <NuxtLink
        v-for="t in tabs"
        :key="t.key"
        :to="t.to"
        class="flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 whitespace-nowrap"
        :class="t.key === tab
          ? 'border-amber-500 text-zinc-100 font-medium'
          : 'border-transparent text-zinc-400 hover:text-zinc-200'"
      >
        <UIcon :name="t.icon" class="size-4" />
        {{ t.label }}
      </NuxtLink>
    </nav>
  </header>
</template>
