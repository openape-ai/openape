<script setup lang="ts">
export interface PrivateDocument {
  type: 'document'
  title: string
  category: string
  language: string | null
  version: number
  documentUrl: string
  editions: { id: string, version: number, title: string, slug: string }[]
}
defineProps<{ report: PrivateDocument }>()
</script>

<template>
  <main class="document-report">
    <header>
      <NuxtLink to="/reports">
        ← All reports
      </NuxtLink>
      <span>{{ report.category }} · Private</span>
    </header>
    <h1>{{ report.title }}</h1>
    <details v-if="report.editions.length > 1">
      <summary>Series editions · {{ report.editions.length }}</summary>
      <ol>
        <li v-for="edition in report.editions" :key="edition.id">
          <NuxtLink :to="`/r/${edition.slug}`">
            {{ edition.version }} · {{ edition.title }}
          </NuxtLink>
        </li>
      </ol>
    </details>
    <iframe :src="report.documentUrl" :title="report.title" sandbox="" referrerpolicy="no-referrer" />
  </main>
</template>

<style scoped>
.document-report{min-height:100dvh;background:#f7f6f1;color:#213c36;padding:24px;font:16px/1.6 system-ui,sans-serif}header{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;font-size:13px}h1{font:clamp(24px,4vw,40px)/1.2 Georgia,serif;overflow-wrap:anywhere;margin:24px 0}a{text-decoration:underline}details{margin:16px 0}iframe{display:block;width:100%;height:80dvh;min-height:480px;border:1px solid #d7ddd4;background:white;border-radius:8px}@media(max-width:600px){.document-report{padding:12px}iframe{height:85dvh}}@media(prefers-color-scheme:dark){.document-report{background:#14231f;color:#e3e9de}}
</style>
