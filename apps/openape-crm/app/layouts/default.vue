<script setup lang="ts">
import { useOpenApeAuth } from '#imports'

const { user } = useOpenApeAuth()
const { list, activeId, select } = useWorkspaces()

const links = [
  { label: 'Board', to: '/board' },
  { label: 'Kontakte', to: '/contacts' },
  { label: 'Workspace', to: '/workspace' },
]
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header v-if="user" class="border-b border-zinc-800">
      <div class="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <NuxtLink to="/board" class="font-semibold tracking-tight">
          OpenApe <span class="text-primary-400">CRM</span>
        </NuxtLink>

        <nav class="flex items-center gap-4 text-sm">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="text-zinc-400 hover:text-zinc-100"
            active-class="text-zinc-100"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>

        <div class="ms-auto flex items-center gap-3">
          <USelect
            v-if="list.length > 1"
            :model-value="activeId"
            :items="list.map(w => ({ label: w.name, value: w.id }))"
            size="sm"
            @update:model-value="select($event as string)"
          />
          <span class="text-xs text-zinc-500 hidden sm:inline">{{ user.sub }}</span>
        </div>
      </div>
    </header>

    <slot />
  </div>
</template>
