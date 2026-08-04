<script setup lang="ts">
import { PERSONA_CATEGORIES, PERSONAS } from '#shared/persona-catalog'

// Agent-Catalog documentation page: lists the personas from the catalog — the
// single source of truth for company personas. The catalog lives in shared/, so
// this static page imports it directly and prerenders.
const { t } = useI18n()
useSeoMeta({
  title: () => t('docs.catalog.tabTitle'),
  description: () => t('docs.catalog.description'),
})
</script>

<template>
  <DocsGuideShell>
    <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">
      {{ $t('docs.catalog.heading') }}
    </h1>
    <i18n-t keypath="docs.catalog.intro" tag="p" class="mt-3 max-w-2xl text-zinc-400">
      <template #count>
        {{ PERSONAS.length }}
      </template>
      <template #link>
        <a href="https://github.com/openape-ai/agent-catalog" target="_blank" rel="noopener" class="text-primary-400 hover:text-primary-300">github.com/openape-ai/agent-catalog</a>
      </template>
    </i18n-t>

    <section class="mt-12">
      <h2 class="text-xl font-semibold text-white">
        {{ $t('docs.catalog.compose.title') }}
      </h2>
      <div class="prose mt-4 max-w-2xl text-zinc-400">
        <i18n-t keypath="docs.catalog.compose.spawn" tag="p">
          <template #role>
            <code>role</code>
          </template>
        </i18n-t>
        <p>
          {{ $t('docs.catalog.compose.scale') }}
        </p>
      </div>
    </section>

    <section v-for="cat in PERSONA_CATEGORIES" :key="cat.key" class="mt-12">
      <h2 class="text-xl font-semibold text-white">
        {{ cat.label }}
      </h2>
      <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="persona in PERSONAS.filter(p => p.category === cat.key)"
          :key="persona.key"
          class="group overflow-hidden rounded-2xl bg-zinc-900/50 ring-1 ring-zinc-800 transition hover:ring-primary-500/50"
        >
          <div class="p-5">
            <div class="flex items-center gap-3">
              <span :class="persona.icon" class="text-2xl text-primary-400" />
              <h3 class="font-semibold text-white group-hover:text-primary-400">
                {{ persona.title }}
              </h3>
            </div>
            <p class="mt-2 text-sm text-zinc-400">
              {{ persona.summary }}
            </p>
            <div class="mt-4 flex items-center gap-2 text-xs">
              <span class="rounded bg-zinc-800 px-2 py-1 text-zinc-400">
                {{ persona.role }}
              </span>
              <span v-if="persona.coding" class="rounded bg-green-900/30 px-2 py-1 text-green-400">
                {{ $t('docs.catalog.codesBadge') }}
              </span>
            </div>
            <p class="mt-2 text-xs text-zinc-500">
              {{ $t('docs.catalog.recipeLabel') }} <code>{{ persona.recipeRef }}</code>
            </p>
          </div>
        </div>
      </div>
    </section>

    <i18n-t keypath="docs.catalog.footer" tag="footer" class="mt-16 border-t border-zinc-800/80 pt-6 text-sm text-zinc-500">
      <template #file>
        <code>persona-catalog.ts</code>
      </template>
    </i18n-t>
  </DocsGuideShell>
</template>

<style scoped>
.prose { line-height: 1.7; }
.prose :deep(p) { margin: 0.5rem 0; }
.prose :deep(strong) { color: #e4e4e7; }
.prose :deep(a) { color: var(--ui-primary, #34d399); }
.prose :deep(code) {
  background: #18181b; border: 1px solid #27272a; border-radius: 4px;
  padding: 0.1em 0.4em; font-size: 0.875em; color: #d4d4d8;
}
</style>
