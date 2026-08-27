<script setup lang="ts">
const props = defineProps<{ pane: string, unread?: number }>()
const emit = defineEmits<{ search: [] }>()

const items = [
  { id: 'vorgaenge', to: '/vorgaenge', icon: 'i-lucide-columns-3', title: 'Vorgänge' },
  { id: 'aufgaben', to: '/aufgaben', icon: 'i-lucide-check', title: 'Aufgaben' },
  { id: 'support', to: '/support', icon: 'i-lucide-mail', title: 'Support' },
  { id: 'kontakte', to: '/kontakte', icon: 'i-lucide-contact', title: 'Kontakte' },
  { id: 'katalog', to: '/katalog', icon: 'i-lucide-list', title: 'Katalog' },
]
</script>

<template>
  <nav class="flex h-full w-[52px] shrink-0 flex-col items-center gap-1.5 border-r border-[var(--crm-line)] bg-[#090b0f] py-3">
    <div
      class="mb-2 grid size-7 place-items-center rounded-lg text-sm text-white"
      style="background: linear-gradient(135deg, var(--crm-accent), var(--crm-cyan))"
    >
      ◑
    </div>
    <NuxtLink
      v-for="item in items"
      :key="item.id"
      :to="item.to"
      :title="item.title"
      class="relative grid size-[34px] place-items-center rounded-lg text-[var(--crm-ink-2)] hover:bg-[var(--crm-panel-2)] hover:text-[var(--crm-ink)]"
      :class="props.pane === item.id ? 'bg-[var(--crm-accent-soft)] text-[var(--crm-accent-2)]' : ''"
    >
      <UIcon :name="item.icon" class="size-4" />
      <span
        v-if="item.id === 'support' && (props.unread ?? 0) > 0"
        class="absolute top-[5px] right-[5px] size-1.5 rounded-full bg-[var(--crm-rose)]"
      />
    </NuxtLink>
    <div class="flex-1" />
    <button type="button" class="grid size-[34px] place-items-center rounded-lg text-[var(--crm-ink-2)] hover:bg-[var(--crm-panel-2)]" title="Suche  ⌘K" data-cmdk @click="emit('search')">
      <UIcon name="i-lucide-search" class="size-4" />
    </button>
    <slot name="user" />
  </nav>
</template>
