<script setup lang="ts">
defineProps<{ email?: string }>()
</script>

<template>
  <header class="border-b border-default">
    <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-8">
      <NuxtLink to="/vault" class="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-default">
        <svg viewBox="0 0 100 100" width="30" height="30" aria-hidden="true">
          <rect width="100" height="100" rx="22" fill="#212C3A" />
          <g fill="none" stroke="#38BDF8" stroke-width="7" stroke-linecap="round">
            <path d="M50 58a10 10 0 0 1 0-16" />
            <path d="M38 66a24 24 0 0 1 0-32" />
            <path d="M26 74a40 40 0 0 1 0-48" />
          </g>
          <circle cx="60" cy="50" r="7" fill="#38BDF8" />
        </svg>
        Secrets
      </NuxtLink>
      <span v-if="email" class="text-sm text-dimmed">{{ email }}</span>
    </div>
  </header>
</template>
