<script setup lang="ts">
import { docsGuide } from '../../docs.generated'

// Guide overview: every category with its user stories. All content is
// generated from the E2E test run (see compose/demo/story-kit.mjs) — our own
// committed HTML, so v-html is safe.
const { t } = useI18n()
useSeoMeta({
  title: () => t('docs.index.tabTitle'),
  description: () => t('docs.index.description'),
})
</script>

<template>
  <DocsGuideShell>
    <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">
      {{ $t('docs.index.heading') }}
    </h1>
    <p class="mt-3 max-w-2xl text-zinc-400">
      {{ $t('docs.index.intro') }}
    </p>

    <NuxtLink to="/docs/agent-catalog" class="mt-6 inline-flex items-center text-sm text-primary-400 hover:text-primary-300">
      {{ $t('docs.index.catalogLink') }}
    </NuxtLink>

    <section v-for="cat in docsGuide.categories" :key="cat.title" class="mt-12">
      <h2 class="text-xl font-semibold text-white">
        {{ cat.title }}
      </h2>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <NuxtLink
          v-for="s in cat.stories" :key="s.id" :to="`/docs/${s.id}`"
          class="group overflow-hidden rounded-2xl bg-zinc-900/50 ring-1 ring-zinc-800 transition hover:ring-primary-500/50"
        >
          <img
            v-if="s.steps.find(st => st.shot)"
            :src="s.steps.find(st => st.shot)!.shot!"
            :alt="s.title"
            loading="lazy"
            class="aspect-video w-full border-b border-zinc-800 object-cover object-top"
          >
          <div class="p-5">
            <h3 class="font-semibold text-white group-hover:text-primary-400">
              {{ s.title }}
            </h3>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="prose-intro mt-2 line-clamp-3 text-sm text-zinc-400" v-html="s.introHtml" />
            <p class="mt-3 text-xs text-zinc-500">
              {{ $t('docs.index.stepCount', s.steps.length) }}
            </p>
          </div>
        </NuxtLink>
      </div>
    </section>

    <footer class="mt-16 border-t border-zinc-800/80 pt-6 text-sm text-zinc-500">
      {{ $t('docs.index.footer') }}
    </footer>
  </DocsGuideShell>
</template>

<style scoped>
.prose-intro :deep(code) {
  background: #18181b; border: 1px solid #27272a; border-radius: 4px;
  padding: 0.05em 0.3em; font-size: 0.875em; color: #d4d4d8;
}
.prose-intro :deep(strong) { color: #e4e4e7; }
</style>
