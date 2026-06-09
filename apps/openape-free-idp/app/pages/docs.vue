<script setup lang="ts">
import { docsMeta, docsSections } from '../docs.generated'

// Public flow docs for this app, rendered from docs/flows.md (build-time). The
// HTML is our own committed content, so v-html is safe here (no user input).
useSeoMeta({
  title: 'OpenApe IdP — flow docs',
  description: 'How identities work on this DDISA IdP — captured live from the E2E test stack.',
})
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden="true">🪪</span>
          <span>OpenApe ID</span>
        </NuxtLink>
        <span class="rounded-full bg-primary-500/10 px-2.5 py-0.5 text-xs font-medium text-primary-400 ring-1 ring-primary-500/30">
          Flow docs
        </span>
        <div class="ms-auto">
          <UButton to="/" size="sm" color="primary" variant="soft">
            Open OpenApe ID
          </UButton>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-3xl px-4 pb-24 pt-12">
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">
        {{ docsMeta.title }}
      </h1>
      <!-- eslint-disable vue/no-v-html -->
      <div class="prose mt-4 text-zinc-400" v-html="docsMeta.introHtml" />

      <nav v-if="docsSections.length > 1" class="mt-8 flex flex-wrap gap-2" aria-label="Flows">
        <a
          v-for="s in docsSections" :key="s.id" :href="`#${s.id}`"
          class="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-sm text-zinc-300 transition hover:border-primary-500/50 hover:text-primary-400"
        >
          {{ s.title }}
        </a>
      </nav>

      <section
        v-for="(s, i) in docsSections" :id="s.id" :key="s.id"
        class="mt-10 scroll-mt-20 rounded-2xl bg-zinc-900/50 p-6 ring-1 ring-zinc-800 sm:p-8"
      >
        <h2 class="flex items-baseline gap-3 text-xl font-semibold text-white">
          <span class="font-mono text-sm text-primary-500">{{ String(i + 1).padStart(2, '0') }}</span>
          {{ s.title }}
        </h2>
        <div class="prose mt-3" v-html="s.html" />
      </section>
      <!-- eslint-enable vue/no-v-html -->

      <footer class="mt-16 border-t border-zinc-800/80 pt-6 text-sm text-zinc-500">
        Captured live from the containerized E2E test stack — every screenshot is
        regenerated on each run, so these docs cannot drift from the real flows.
      </footer>
    </main>
  </div>
</template>

<style scoped>
.prose { line-height: 1.7; }
.prose :deep(p) { margin: 0.75rem 0; color: #a1a1aa; }
.prose :deep(strong) { color: #e4e4e7; }
.prose :deep(a) { color: var(--ui-primary, #34d399); }
.prose :deep(code) {
  background: #18181b; border: 1px solid #27272a; border-radius: 4px;
  padding: 0.1em 0.4em; font-size: 0.875em; color: #d4d4d8;
}

/* Screenshot frames — a minimal browser chrome around each captured PNG. */
.prose :deep(.shot) {
  margin: 1.5rem 0 0.5rem;
  border: 1px solid #27272a; border-radius: 12px; overflow: hidden;
  background: #18181b; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
}
.prose :deep(.shot-bar) {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-bottom: 1px solid #27272a; background: #111113;
}
.prose :deep(.shot-dot) {
  width: 10px; height: 10px; border-radius: 50%; background: #3f3f46;
}
.prose :deep(.shot-label) {
  margin-left: 8px; font-size: 0.75rem; color: #71717a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.prose :deep(.shot img) { display: block; width: 100%; height: auto; }
</style>
