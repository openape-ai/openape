<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { HtmlReportView } from '../../shared/html-view'

const props = defineProps<{ report: HtmlReportView }>()
const ready = ref(false)
onMounted(() => { ready.value = true })
const viewer = ref('')
const error = ref('')
const loading = ref(false)
const history = ref<{ version: number, version_url: string, author: string }[]>([])
watch(() => props.report.publication_id, () => { viewer.value = ''; error.value = '' })
async function loadViewer() {
  loading.value = true; error.value = ''
  try {
    const result = await $fetch<{ url: string }>(`/api/documents/${props.report.document_id}/viewer`, { method: 'POST', query: { revision: props.report.version } })
    viewer.value = result.url
  }
  catch { error.value = 'The report is unavailable or access changed. Reload to check the current policy.' }
  finally { loading.value = false }
}
async function loadHistory() {
  try {
    const result = await $fetch<{ items: typeof history.value }>(`/api/documents/${props.report.document_id}/history`, { query: { limit: 100 } })
    history.value = result.items
  }
  catch { error.value = 'History is unavailable. Reload to check your access.' }
}
</script>

<template>
  <main class="html-report">
    <header>
      <NuxtLink to="/reports">
        ← Reports
      </NuxtLink>
      <span>{{ report.audience }} · {{ report.expires_at ? `Expires ${new Date(report.expires_at).toLocaleString()}` : 'Permanent' }}</span>
    </header>
    <h1>{{ report.title }}</h1>
    <p>{{ report.category || 'Uncategorized' }} · Version {{ report.version }} of {{ report.latest_version }} · {{ report.author }}</p>
    <nav aria-label="Report controls">
      <NuxtLink :to="`/d/${report.document_id}`">
        Latest
      </NuxtLink>
      <a :href="report.version_url">Exact version</a>
      <button type="button" :disabled="!ready" @click="loadHistory">
        History
      </button>
      <a :href="`/api/documents/${report.document_id}/html?revision=${report.version}`" download>Download HTML</a>
      <NuxtLink v-if="report.legacy_plan_id && report.caller_role !== 'reader'" :to="`/d/${report.document_id}/edit`">
        Edit plan source
      </NuxtLink>
    </nav>
    <ul v-if="history.length" aria-label="Version history">
      <li v-for="version in history" :key="version.version">
        <a :href="version.version_url">Version {{ version.version }}</a> · {{ version.author }}
      </li>
    </ul>
    <div class="tags">
      <NuxtLink v-for="tag in report.tags" :key="tag" :to="{ path: '/reports', query: { tag } }">
        {{ tag }}
      </NuxtLink>
    </div>
    <dl v-if="Object.keys(report.metadata).length">
      <template v-for="(value, key) in report.metadata" :key="key">
        <dt>{{ key }}</dt><dd>{{ value }}</dd>
      </template>
    </dl>
    <section class="trust-notice" aria-label="Active document notice">
      <p>This document contains publisher-controlled HTML and may run JavaScript. Only open active content from a publisher you trust. Reports isolates its application access; document code may send data over the network.</p>
      <p v-if="report.external_images.length">
        {{ report.external_images.length }} external image reference(s) load directly from their providers. Their content may change and is not preserved by this version.
      </p>
      <details v-if="report.external_images.length">
        <summary>External image dependencies</summary><ul>
          <li v-for="url in report.external_images" :key="url">
            {{ url }}
          </li>
        </ul>
      </details>
      <button v-if="!viewer" type="button" :disabled="loading || !ready" @click="loadViewer">
        {{ loading ? 'Opening…' : 'Open active document' }}
      </button>
    </section>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
    <iframe v-if="viewer" :key="report.publication_id" :src="viewer" sandbox="allow-scripts" referrerpolicy="no-referrer" :title="report.title" />
    <details v-if="report.external_links.length">
      <summary>Document links</summary><ul>
        <li v-for="url in report.external_links" :key="url">
          <a :href="url" target="_blank" rel="noopener noreferrer">{{ url }}</a>
        </li>
      </ul>
    </details>
    <footer>SHA-256 {{ report.artifact_digest }}<br>Downloaded files do not retain the hosted viewer's isolation policy.</footer>
  </main>
</template>

<style scoped>
.html-report{background:#f7f6f1;min-height:100dvh;padding:24px;max-width:1600px;margin:auto;font:16px/1.6 system-ui;color:#203b36}header,nav,.tags{display:flex;gap:18px;flex-wrap:wrap;align-items:center}header{justify-content:space-between}h1{font-size:clamp(1.8rem,5vw,3rem);line-height:1.2;overflow-wrap:anywhere}button,a{color:inherit}button{font:inherit;border:1px solid currentColor;padding:6px 14px;border-radius:6px;cursor:pointer}nav{margin:20px 0}.trust-notice{background:#edf2eb;border:1px solid #a3b3a3;border-radius:8px;padding:16px;margin:20px 0}iframe{display:block;width:100%;height:80vh;min-height:550px;border:1px solid #a3b3a3;background:white}li,dd,footer{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:minmax(100px,1fr) 3fr;gap:8px}footer{font:12px monospace;margin:24px 0}.tags a{border:1px solid #a3b3a3;border-radius:14px;padding:2px 10px}@media(prefers-color-scheme:dark){.html-report{color:#dce7df;background:#14231f}.trust-notice{background:#1c332b}}@media(max-width:480px){.html-report{padding:16px}iframe{min-height:420px}nav{gap:12px}}
</style>
