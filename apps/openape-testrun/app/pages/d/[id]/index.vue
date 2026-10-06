<script setup lang="ts">
import type { HtmlReportView } from '../../../../shared/html-view'
import HtmlReport from '../../../components/HtmlReport.vue'

const route = useRoute()
const { data, error } = await useFetch<HtmlReportView>(() => `/api/documents/${route.params.id}`, { query: computed(() => ({ revision: route.query.v })) })
useSeoMeta({ title: () => data.value?.title ?? 'Report unavailable', robots: 'noindex, nofollow', referrer: 'no-referrer' })
useHead({ meta: [{ 'http-equiv': 'Content-Security-Policy', 'content': `frame-src ${useRuntimeConfig().public.htmlContentOrigin || '\'none\''}` }] })
</script>

<template>
  <HtmlReport v-if="data" :report="data" />
  <main v-else class="unavailable">
    <h1>Report unavailable</h1><p>{{ error?.statusCode === 410 ? 'This report has expired or was removed.' : 'Sign in with an authorized account to read this report.' }}</p><NuxtLink :to="{ path: '/', query: { returnTo: route.fullPath } }">
      Sign in with OpenApe
    </NuxtLink>
  </main>
</template>

<style scoped>
.unavailable{font:18px system-ui;padding:10vh 8vw;max-width:800px}h1{font-size:2.5rem}
</style>
