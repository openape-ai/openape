<script setup lang="ts">
import type { PublicRun } from '../../components/TestReport.vue'
import type { Briefing } from '../../../shared/briefing'
import TestReport from '../../components/TestReport.vue'
import BriefingReport from '../../components/BriefingReport.vue'
import DocumentReport from '../../components/DocumentReport.vue'
import type { PrivateDocument } from '../../components/DocumentReport.vue'

interface PrivateBriefing { type: 'briefing', briefing: Briefing, version: number, latest_version: number, editions: { version: number, date: string }[] }
const route = useRoute()
const { data, error } = await useFetch<PublicRun & { type?: 'test' } | PrivateBriefing | PrivateDocument>(
  `/api/public/runs/${route.params.slug}`,
  { query: computed(() => (route.query.v ? { v: route.query.v } : {})) },
)
useSeoMeta({
  title: () => data.value && data.value.type !== 'briefing' && data.value.type !== 'document' ? `${data.value.title} — OpenApe Testrun` : 'OpenApe Reports',
  description: () => data.value && data.value.type !== 'briefing' && data.value.type !== 'document' ? `${data.value.status.toUpperCase()}: ${data.value.passed} passed, ${data.value.failed} failed` : 'Your private report',
  robots: 'noindex, nofollow', referrer: 'no-referrer',
})
</script>

<template>
  <main v-if="error" class="report-access">
    <p class="eyebrow">
      OpenApe Reports
    </p>
    <h1>{{ error.statusCode === 401 ? 'Your report, privately.' : 'Report unavailable' }}</h1>
    <p>{{ error.statusCode === 401 ? 'Sign in with your OpenApe account to read this report.' : 'This report is unavailable for your account.' }}</p>
    <NuxtLink :to="{ path: '/', query: { returnTo: route.fullPath } }">
      Sign in with OpenApe →
    </NuxtLink>
  </main>
  <BriefingReport v-else-if="data?.type === 'briefing'" :report="data.briefing" :version="data.version" :latest-version="data.latest_version" :editions="data.editions" />
  <DocumentReport v-else-if="data?.type === 'document'" :report="data" />
  <TestReport v-else-if="data" :run="data" />
</template>

<style scoped>
.report-access { min-height: 100dvh; padding: 15vh 8vw; background: #f6f5f0; color: #203a36; font-family: system-ui, sans-serif; }
h1 { font-size: clamp(2rem, 6vw, 4rem); font-weight: 550; max-width: 16ch; line-height: 1.1; margin: 1rem 0; }
p { max-width: 42rem; margin-bottom: 2rem; }
a { display: inline-block; padding: 1rem 1.4rem; border: 1px solid; border-radius: 2rem; }
.eyebrow { text-transform: uppercase; letter-spacing: .16em; font-size: .75rem; }
@media (prefers-color-scheme: dark) { .report-access { background: #14221f; color: #e2e7e0; } }
</style>
