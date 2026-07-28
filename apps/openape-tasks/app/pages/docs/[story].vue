<script setup lang="ts">
import { docsGuide } from '../../docs.generated'

// A single user story: numbered steps, each with its caption and the
// screenshot captured by the E2E run. Content is our own committed HTML.
const route = useRoute()
const all = docsGuide.categories.flatMap(c => c.stories.map(s => ({ ...s, category: c.title })))
const idx = computed(() => all.findIndex(s => s.id === route.params.story))
if (idx.value === -1)
  throw createError({ statusCode: 404, statusMessage: 'Story not found' })
const story = computed(() => all[idx.value]!)
const prev = computed(() => all[idx.value - 1])
const next = computed(() => all[idx.value + 1])

useSeoMeta({ title: () => `${story.value.title} — OpenApe Tasks Guide` })
</script>

<template>
  <DocsGuideShell>
    <p class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
      {{ story.category }}
    </p>
    <h1 class="mt-1 text-3xl font-bold tracking-tight">
      {{ story.title }}
    </h1>
    <!-- eslint-disable vue/no-v-html -->
    <div class="prose mt-4 max-w-2xl text-zinc-400" v-html="story.introHtml" />

    <ol class="mt-10 space-y-12">
      <li v-for="(st, i) in story.steps" :key="i">
        <h2 class="flex items-baseline gap-3 text-lg font-semibold text-white">
          <span class="font-mono text-sm text-primary-500">{{ String(i + 1).padStart(2, '0') }}</span>
          {{ st.title }}
        </h2>
        <div class="prose mt-2 max-w-2xl text-zinc-400" v-html="st.html" />
        <figure v-if="st.shot" class="shot mt-4">
          <figcaption class="shot-bar">
            <span class="shot-dot" /><span class="shot-dot" /><span class="shot-dot" />
            <span class="shot-label">{{ st.title }}</span>
          </figcaption>
          <img :src="st.shot" :alt="st.title" loading="lazy">
        </figure>
      </li>
    </ol>
    <!-- eslint-enable vue/no-v-html -->

    <nav class="mt-16 flex items-center justify-between gap-4 border-t border-zinc-800/80 pt-6 text-sm">
      <NuxtLink v-if="prev" :to="`/docs/${prev.id}`" class="text-zinc-400 transition hover:text-primary-400">
        ← {{ prev.title }}
      </NuxtLink>
      <span v-else />
      <NuxtLink v-if="next" :to="`/docs/${next.id}`" class="text-right text-zinc-400 transition hover:text-primary-400">
        {{ next.title }} →
      </NuxtLink>
    </nav>
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

/* Screenshot frame — minimal browser chrome around the captured PNG. */
.shot {
  border: 1px solid #27272a; border-radius: 12px; overflow: hidden;
  background: #18181b; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
}
.shot-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-bottom: 1px solid #27272a; background: #111113;
}
.shot-dot { width: 10px; height: 10px; border-radius: 50%; background: #3f3f46; }
.shot-label {
  margin-left: 8px; font-size: 0.75rem; color: #71717a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.shot img { display: block; width: 100%; height: auto; }
</style>
