<script setup lang="ts">
import { docsHtml } from '../docs.generated'

// Public flow docs for this app, rendered from docs/flows.md (build-time). The
// HTML is our own committed content, so v-html is safe here (no user input).
useSeoMeta({ title: 'OpenApe IdP — flow docs' })
</script>

<template>
  <main class="docs">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="prose" v-html="docsHtml" />
  </main>
</template>

<style scoped>
.docs {
  max-width: 860px;
  margin: 0 auto;
  padding: 3rem 1.25rem 6rem;
  color: #e5e7eb;
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
.prose :deep(h1) { font-size: 2rem; color: #fff; margin: 0 0 1.5rem; line-height: 1.25; }
.prose :deep(h2) {
  font-size: 1.4rem; color: #fff; margin: 2.75rem 0 1rem; padding-top: 1.5rem;
  border-top: 1px solid #1f2937; line-height: 1.25;
}
.prose :deep(h3) { font-size: 1.1rem; color: #fff; margin: 1.75rem 0 .75rem; }
.prose :deep(p) { margin: .75rem 0; }
.prose :deep(a) { color: #34d399; }
.prose :deep(img) {
  display: block; max-width: 100%; height: auto; margin: 1rem 0;
  border: 1px solid #1f2937; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4);
}
.prose :deep(code) { background: #111827; padding: .15em .4em; border-radius: 4px; font-size: .9em; }
.prose :deep(pre) { background: #111827; padding: 1rem; border-radius: 8px; overflow: auto; border: 1px solid #1f2937; }
.prose :deep(pre code) { background: none; padding: 0; }
</style>
