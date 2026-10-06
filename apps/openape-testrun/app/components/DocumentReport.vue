<script setup lang="ts">
export interface PrivateDocument {
  type: 'document'
  title: string
  category: string
  language: string | null
  version: number
  documentUrl: string
  artifactDigest: string
  editions: { id: string, version: number, title: string, slug: string }[]
  created_by: string
  created_by_act: 'human' | 'agent'
  created_at: number
  visibility: 'shared' | 'private'
}
defineProps<{ report: PrivateDocument }>()
</script>

<template>
  <div class="document-report">
    <details v-if="report.editions.length > 1" class="editions">
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
  </div>
</template>

<style scoped>
.document-report { height: 100%; display: flex; flex-direction: column; }
.editions { flex: none; padding: 10px 16px; border-bottom: 1px solid var(--rule); font-size: 14px; }
.editions summary { cursor: pointer; font-weight: 600; }
.editions ol { margin: 8px 0 0; padding-left: 20px; overflow-wrap: anywhere; }
iframe { display: block; flex: 1; min-height: 0; width: 100%; border: 0; background: #fff; }
</style>
