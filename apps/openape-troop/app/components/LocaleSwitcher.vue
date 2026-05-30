<script setup lang="ts">
// DE/EN pill toggle for the page header. Drops into any of the sticky
// page headers (pages/agents/index.vue, pages/agents/[name].vue) and
// shares the same color palette as the existing header buttons.
//
// Clicking a pill calls `setLocale()` from @nuxtjs/i18n which:
//   1. mutates the reactive `locale` ref → every $t() in the tree
//      re-evaluates synchronously, no page reload
//   2. writes the new code to the `troop-locale` cookie (configured in
//      nuxt.config.ts under i18n.detectBrowserLanguage.cookieKey),
//      so the choice survives a hard refresh.

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
