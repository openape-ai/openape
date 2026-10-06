<script setup lang="ts">
import type { HtmlReportView } from '../../../../shared/html-view'
import HtmlReport from '../../../components/HtmlReport.vue'
import ReportUnavailable from '../../../components/ReportUnavailable.vue'

const route = useRoute()
const { data, error } = await useFetch<HtmlReportView>(() => `/api/documents/${route.params.id}`, { query: computed(() => ({ revision: route.query.v })) })
useSeoMeta({ title: () => data.value?.title ?? 'Report unavailable', robots: 'noindex, nofollow', referrer: 'no-referrer' })
useHead({ meta: [{ 'http-equiv': 'Content-Security-Policy', 'content': `frame-src ${useRuntimeConfig().public.htmlContentOrigin || '\'none\''}` }] })
</script>

<template>
  <HtmlReport v-if="data" :report="data" />
  <ReportUnavailable v-else :status="error?.statusCode" :return-to="route.fullPath" />
</template>
