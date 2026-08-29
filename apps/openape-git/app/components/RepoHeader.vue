<script setup lang="ts">
const props = defineProps<{
  owner: string
  name: string
  tab: 'code' | 'commits' | 'pulls' | 'settings'
}>()

const tabs = computed(() => [
  { key: 'code', label: 'Code', icon: 'i-lucide-folder-git-2', to: `/${props.owner}/${props.name}` },
  { key: 'commits', label: 'Commits', icon: 'i-lucide-history', to: `/${props.owner}/${props.name}/commits` },
  { key: 'pulls', label: 'Pulls', icon: 'i-lucide-git-pull-request', to: `/${props.owner}/${props.name}/pulls` },
  { key: 'settings', label: 'Access', icon: 'i-lucide-key-round', to: `/${props.owner}/${props.name}/settings` },
])
</script>

<template>
  <header class="border-b border-zinc-800 px-4 pt-3">
    <div class="flex items-center justify-between gap-3">
      <NuxtLink to="/" class="font-bold text-lg shrink-0">
        🦍 ape-git
      </NuxtLink>
      <span class="font-mono text-sm text-zinc-400 truncate">
        {{ owner }}<span class="text-zinc-600">/</span>{{ name }}
      </span>
    </div>
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
