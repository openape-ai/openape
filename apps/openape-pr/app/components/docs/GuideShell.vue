<script setup lang="ts">
import { docsGuide } from '../../docs.generated'

// Guide chrome shared by the /docs pages: branded header + category/story
// sidebar. Content (overview or a single story) renders into the slot.
const route = useRoute()
const activeStory = computed(() => route.params.story as string | undefined)
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden="true">💬</span>
          <span>OpenApe PR</span>
        </NuxtLink>
        <NuxtLink
          to="/docs"
          class="rounded-full bg-primary-500/10 px-2.5 py-0.5 text-xs font-medium text-primary-400 ring-1 ring-primary-500/30"
        >
          Guide
        </NuxtLink>
        <div class="ms-auto">
          <UButton to="/" size="sm" color="primary" variant="soft">
            Open PR
          </UButton>
        </div>
      </div>
    </header>

    <div class="mx-auto flex max-w-6xl gap-10 px-4 pb-24 pt-10">
      <aside class="hidden w-60 shrink-0 lg:block">
        <nav class="sticky top-24 space-y-6 text-sm" aria-label="Guide">
          <NuxtLink
            to="/docs"
            class="block font-medium transition"
            :class="activeStory ? 'text-zinc-400 hover:text-zinc-200' : 'text-primary-400'"
          >
            Overview
          </NuxtLink>
          <div v-for="cat in docsGuide.categories" :key="cat.title">
            <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {{ cat.title }}
            </p>
            <ul class="space-y-1 border-l border-zinc-800">
              <li v-for="s in cat.stories" :key="s.id">
                <NuxtLink
                  :to="`/docs/${s.id}`"
                  class="-ml-px block border-l py-1 pl-3 transition"
                  :class="activeStory === s.id
                    ? 'border-primary-500 text-primary-400'
                    : 'border-transparent text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'"
                >
                  {{ s.title }}
                </NuxtLink>
              </li>
            </ul>
          </div>
        </nav>
      </aside>

      <main class="min-w-0 flex-1">
        <slot />
      </main>
    </div>
  </div>
</template>
