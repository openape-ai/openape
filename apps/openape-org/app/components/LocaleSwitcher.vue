<script setup lang="ts">
// DE/EN pill toggle, same pattern as troop. setLocale() swaps the
// reactive locale (every $t() re-evaluates without page reload) and
// writes the `org-locale` cookie so the choice survives a refresh.
const { locale, locales, setLocale } = useI18n()
</script>

<template>
  <div class="inline-flex rounded-md border border-(--ui-border) overflow-hidden text-xs">
    <button
      v-for="l in locales"
      :key="l.code"
      type="button"
      class="px-2 py-1 transition-colors uppercase tracking-wide cursor-pointer"
      :class="locale === l.code
        ? 'bg-zinc-700 text-zinc-50 font-semibold'
        : 'bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'"
      @click="setLocale(l.code)"
    >
      {{ l.code }}
    </button>
  </div>
</template>
