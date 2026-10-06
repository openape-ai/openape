<script setup lang="ts">
import type { PublicRun } from '../../components/TestReport.vue'
import type { Briefing } from '../../../shared/briefing'
import type { PrivateDocument } from '../../components/DocumentReport.vue'
import type { DetailsSection } from '../../components/DocumentBar.vue'
import type { ReportDetails } from '../../components/DetailsDrawer.vue'
import type { AuthorType, Kind } from '../../utils/report-format'
import { ref } from 'vue'
import { accessInfo, KIND_LABEL, kindOf } from '../../utils/report-format'
import BriefingReport from '../../components/BriefingReport.vue'
import DetailsDrawer from '../../components/DetailsDrawer.vue'
import DocumentBar from '../../components/DocumentBar.vue'
import DocumentReport from '../../components/DocumentReport.vue'
import ReaderShell from '../../components/ReaderShell.vue'
import ReportUnavailable from '../../components/ReportUnavailable.vue'
import TestReport from '../../components/TestReport.vue'

interface PrivateBriefing { type: 'briefing', briefing: Briefing, version: number, latest_version: number, editions: { version: number, date: string }[], created_by: string, created_by_act: 'human' | 'agent', created_at: number, visibility: 'shared' | 'private' }
type TestRun = PublicRun & { type?: 'test', visibility?: 'shared' | 'private' }
const route = useRoute()
const { data, error } = await useFetch<TestRun | PrivateBriefing | PrivateDocument>(
  `/api/public/runs/${route.params.slug}`,
  { query: computed(() => (route.query.v ? { v: route.query.v } : {})) },
)
useSeoMeta({
  title: () => data.value && data.value.type !== 'briefing' && data.value.type !== 'document' ? `${data.value.title} — OpenApe Reports` : 'OpenApe Reports',
  description: () => data.value && data.value.type !== 'briefing' && data.value.type !== 'document' ? `${data.value.status.toUpperCase()}: ${data.value.passed} passed, ${data.value.failed} failed` : 'Your private report',
  robots: 'noindex, nofollow', referrer: 'no-referrer',
})

const detailsOpen = ref(false)
const section = ref<DetailsSection>()
function openDetails(target: DetailsSection) { section.value = target; detailsOpen.value = true }
const origin = () => typeof window === 'undefined' ? '' : window.location.origin
const hrefFor = (version: number, latest: number) => version === latest ? route.path : `${route.path}?v=${version}`

// Earlier uploads carry seconds; the reading components take milliseconds.
const view = computed(() => {
  const report = data.value
  if (!report) return null
  const authorType: AuthorType = report.created_by_act === 'agent' ? 'agent' : 'person'
  const access = accessInfo(report.visibility === 'private' ? 'private' : 'link')
  const base = { id: String(route.params.slug), author: report.created_by, authorType, access, url: `${origin()}${route.path}`, tags: [], metadata: {}, expiresAt: null, download: null, digest: null, externalImages: [], externalLinks: [], planStatus: null }
  if (report.type === 'briefing') {
    const versions = report.editions.map(edition => ({ version: edition.version, author: '', at: Date.parse(`${edition.date}T12:00:00Z`), href: hrefFor(edition.version, report.latest_version) }))
    return { kind: 'report' as Kind, title: report.briefing.title, at: report.created_at * 1000, version: report.version, latest: report.latest_version, details: { ...base, title: report.briefing.title, kindLabel: 'Briefings', source: 'Earlier briefing', versions, version: report.version, latestVersion: report.latest_version, versionUrl: `${origin()}${route.path}?v=${report.version}`, isolation: 'Shown directly by Reports; no publisher code runs.' } satisfies ReportDetails }
  }
  if (report.type === 'document') {
    const kind = kindOf(report.category)
    return { kind, title: report.title, at: report.created_at * 1000, version: report.version, latest: report.version, details: { ...base, title: report.title, kindLabel: report.category ?? KIND_LABEL[kind], source: 'Earlier document upload', versions: [], version: report.version, latestVersion: report.version, versionUrl: null, digest: report.artifactDigest, isolation: 'Shown by Reports in a frame where no publisher code runs.' } satisfies ReportDetails }
  }
  const versions = (report.versions.length ? report.versions : [{ version: report.version, created_at: report.created_at }]).map(item => ({ version: item.version, author: report.created_by, at: item.created_at * 1000, href: hrefFor(item.version, report.latest_version) }))
  return { kind: 'testrun' as Kind, title: report.title, at: report.created_at * 1000, version: report.version, latest: report.latest_version, details: { ...base, title: report.title, kindLabel: 'Test Runs', source: 'Earlier Test Run upload', access: accessInfo('link'), versions, version: report.version, latestVersion: report.latest_version, versionUrl: `${origin()}${route.path}?v=${report.version}`, isolation: 'Shown directly by Reports; no publisher code runs.' } satisfies ReportDetails }
})
</script>

<template>
  <ReportUnavailable v-if="error || !view" :status="error?.statusCode" :return-to="route.fullPath" />
  <template v-else>
    <ReaderShell>
      <template #bar>
        <DocumentBar :title="view.title" :kind="view.kind" :author="view.details.author" :author-type="view.details.authorType" :at="view.at" :version="view.version" :latest-version="view.latest" :latest-href="route.path" :expires-at="null" :access="view.details.access" @details="openDetails" />
      </template>
      <div class="native" :class="{ fill: data?.type === 'document' }">
        <BriefingReport v-if="data?.type === 'briefing'" :report="data.briefing" :version="data.version" :latest-version="data.latest_version" :editions="data.editions" />
        <DocumentReport v-else-if="data?.type === 'document'" :report="data" />
        <TestReport v-else-if="data" :run="data" />
      </div>
    </ReaderShell>
    <DetailsDrawer :open="detailsOpen" :section="section" :details="view.details" @close="detailsOpen = false" />
  </template>
</template>

<style scoped>
.native { height: 100%; overflow: auto; background: var(--paper); }
.native.fill { overflow: hidden; }
</style>
