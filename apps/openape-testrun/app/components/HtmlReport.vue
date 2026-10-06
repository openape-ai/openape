<script setup lang="ts">
import type { DetailsSection } from './DocumentBar.vue'
import type { DetailsVersion, ReportDetails } from './DetailsDrawer.vue'
import type { HtmlReportView } from '../../shared/html-view'
import type { Audience } from '../utils/report-format'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { accessInfo, capitalize, KIND_LABEL, kindOf } from '../utils/report-format'
import { toast } from '../utils/toast'
import DetailsDrawer from './DetailsDrawer.vue'
import DocumentBar from './DocumentBar.vue'
import ReaderShell from './ReaderShell.vue'
import TrustGate from './TrustGate.vue'

const props = defineProps<{ report: HtmlReportView }>()
const ready = ref(false)
const viewer = ref('')
const error = ref('')
const loading = ref(false)
const frame = ref<HTMLIFrameElement>()
const teamName = ref<string | null>(null)
const readers = ref<string[] | null>(null)
const versions = ref<DetailsVersion[] | null>(null)
const detailsOpen = ref(false)
const section = ref<DetailsSection>()

const kind = computed(() => kindOf(props.report.category))
const access = computed(() => accessInfo(props.report.audience as Audience, teamName.value, readers.value))
const planStatus = computed(() => props.report.metadata['plans.status'] ? capitalize(props.report.metadata['plans.status']) : null)
const details = computed<ReportDetails>(() => ({
  id: props.report.document_id,
  title: props.report.title,
  kindLabel: props.report.category ?? KIND_LABEL[kind.value],
  planStatus: planStatus.value,
  author: props.report.author,
  authorType: null,
  source: null,
  tags: props.report.tags,
  access: access.value,
  expiresAt: props.report.expires_at,
  versions: versions.value,
  version: props.report.version,
  latestVersion: props.report.latest_version,
  url: props.report.url,
  versionUrl: props.report.version_url,
  download: `/api/documents/${props.report.document_id}/html?revision=${props.report.version}`,
  metadata: props.report.metadata,
  digest: props.report.artifact_digest,
  isolation: 'Runs on a separate web address without your sign-in, cookies or Reports data. Its code can still reach other websites.',
  externalImages: props.report.external_images,
  externalLinks: props.report.external_links,
}))

onMounted(async () => {
  ready.value = true
  if (props.report.audience === 'team') {
    const teams = await $fetch<{ items: { id: string, name: string }[] }>('/api/documents/teams', { query: { limit: 100 } })
    teamName.value = teams.items.find(team => team.id === props.report.team_id)?.name ?? null
  }
})
watch(() => props.report.publication_id, () => { viewer.value = ''; error.value = ''; versions.value = null })

async function loadViewer() {
  loading.value = true; error.value = ''
  try {
    const result = await $fetch<{ url: string }>(`/api/documents/${props.report.document_id}/viewer`, { method: 'POST', query: { revision: props.report.version } })
    viewer.value = result.url
    await nextTick()
    frame.value?.focus()
  }
  catch { error.value = 'The report is unavailable or access changed. Reload to check the current policy.' }
  finally { loading.value = false }
}
async function loadDetails() {
  const id = props.report.document_id
  const [history, policy] = await Promise.all([
    $fetch<{ items: { version: number, author: string, created_at: number }[] }>(`/api/documents/${id}/history`, { query: { limit: 100 } }),
    props.report.audience === 'readers' && ['owner', 'admin'].includes(props.report.caller_role)
      ? $fetch<{ readers: string[] }>(`/api/documents/${id}/access`)
      : Promise.resolve(null),
  ])
  versions.value = history.items.map(item => ({ version: item.version, author: item.author, at: item.created_at, href: item.version === props.report.latest_version ? `/d/${id}` : `/d/${id}?v=${item.version}` }))
  if (policy) readers.value = policy.readers
}
async function openDetails(target: DetailsSection) {
  section.value = target
  detailsOpen.value = true
  if (versions.value) return
  try { await loadDetails() }
  catch { versions.value = []; toast('Version history is unavailable. Reload to check your access.') }
}
</script>

<template>
  <ReaderShell :sealed="!viewer">
    <template #bar>
      <DocumentBar :title="report.title" :kind="kind" :author="report.author" :author-type="null" :at="report.created_at" :version="report.version" :latest-version="report.latest_version" :latest-href="`/d/${report.document_id}`" :expires-at="report.expires_at" :access="access" @details="openDetails" />
    </template>
    <iframe v-if="viewer" ref="frame" :key="report.publication_id" class="document" :src="viewer" sandbox="allow-scripts" referrerpolicy="no-referrer" :title="`${report.title}, version ${report.version}`" />
    <TrustGate v-else :author="report.author" :images="report.external_images.length" :loading="loading" :ready="ready" :error="error" @open="loadViewer" @explain="openDetails('sec-tech')" />
  </ReaderShell>
  <DetailsDrawer :open="detailsOpen" :section="section" :details="details" @close="detailsOpen = false" />
</template>

<style scoped>
.document { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
</style>
