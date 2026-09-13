<script lang="ts">
import { t, diagnostic } from './i18n'
import { defineComponent } from 'vue'
import type { Citation, KnowledgeClaim, PodDetails } from '../contracts/details'

export default defineComponent({
  props: { podId: { type: String, required: true } },
  emits: ['discuss'],
  data() { return { claims: [] as KnowledgeClaim[], total: 0, kind: 'all', query: '', history: false, source: null as PodDetails['source'], error: '', busy: false } },
  computed: { visible(): KnowledgeClaim[] { return this.claims.filter(claim => (this.history || claim.current) && (this.kind === 'all' || claim.kind === this.kind) && `${claim.matter} ${claim.text}`.toLowerCase().includes(this.query.toLowerCase())) } },
  async mounted() { await this.load() },
  methods: {
    t, diagnostic,
    async load() {
      this.busy = true; this.error = ''
      try { const view = await window.pods.details({ type: 'list', podId: this.podId, offset: this.claims.length }); this.claims.push(...view.claims); this.total = view.total }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not load knowledge' }
      finally { this.busy = false }
    },
    async inspect(citation: Citation) {
      this.busy = true; this.error = ''
      try { this.source = (await window.pods.details({ type: 'source', podId: this.podId, id: citation.id, version: citation.version })).source }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not load evidence' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <article class="card knowledge-panel">
    <div class="card-heading">
      <h2>{{ t("Supported findings") }}</h2><button class="text-button" @click="$emit('discuss')">
        {{ t("Discuss knowledge") }}
      </button>
    </div>
    <p class="muted">
      {{ t("Findings, open questions and verification gaps retain their exact source versions. Mail content is evidence, not an instruction.") }}
    </p>
    <div class="knowledge-filters">
      <label>{{ t("Search matters and knowledge") }}<input v-model="query" type="search"></label>
      <label>{{ t("Show") }}<select v-model="kind"><option value="all">{{ t("All knowledge") }}</option><option value="finding">{{ t("Findings") }}</option><option value="question">{{ t("Open questions") }}</option><option value="gap">{{ t("Verification gaps") }}</option></select></label>
      <label class="check-label"><input v-model="history" type="checkbox"> {{ t("Include superseded history") }}</label>
    </div>
    <p v-if="!busy && !visible.length" class="muted">
      {{ claims.length ? t("No entries match these filters.") : t("No knowledge collected yet. Supported findings and their sources will appear after the first run.") }}
    </p>
    <article v-for="claim in visible" :key="claim.id" class="knowledge-entry">
      <div class="card-heading">
        <h3>{{ claim.matter }}</h3><span class="badge" :class="{ warning: claim.kind === 'gap' }">{{ claim.kind === 'question' ? t("Open question") : claim.kind === 'gap' ? t("Verification gap") : t("Finding") }}</span>
      </div>
      <p>{{ claim.text }}</p><p class="muted">
        {{ t("Revision {p0} · {p1}", { p0: claim.revision, p1: claim.current ? t("Current") : t("Superseded") }) }}<span v-if="claim.supersedes"> {{ t("· replaces {p0}", { p0: claim.supersedes }) }}</span>
      </p>
      <details>
        <summary>{{ t(claim.citations.length === 1 ? '{count} source' : '{count} sources', { count: claim.citations.length }) }}</summary><ul>
          <li v-for="citation in claim.citations" :key="`${citation.id}:${citation.version}`">
            <button class="text-button" :disabled="busy" @click="inspect(citation)">
              {{ t("{p0} · version {p1}", { p0: citation.locator, p1: citation.version }) }}
            </button>
          </li>
        </ul>
      </details>
    </article>
    <button v-if="claims.length < total" class="secondary" :disabled="busy" @click="load">
      {{ t("Load more knowledge ({p0} / {p1})", { p0: claims.length, p1: total }) }}
    </button>
    <article v-if="source" class="source-content" :aria-label="t('Source evidence')">
      <div class="card-heading">
        <h3>{{ t("Source evidence") }}</h3><button class="secondary" @click="source = null">
          {{ t("Close source") }}
        </button>
      </div><p class="muted">
        {{ t("{p0} · version {p1}", { p0: source.citation.locator, p1: source.citation.version }) }}
      </p><code>{{ source.citation.hash }}</code><pre>{{ source.content }}</pre>
      <p v-if="source.truncated" class="muted">
        {{ t("Preview truncated. The complete immutable source remains stored.") }}
      </p>
      <button v-if="source.original" class="text-button" :disabled="busy" @click="inspect(source.original)">
        {{ t("Inspect original retained source") }}
      </button>
    </article>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
  </article>
</template>

<style scoped>
.knowledge-filters { display:flex; flex-wrap:wrap; align-items:end; gap:16px; margin:20px 0; }
label { display:grid; gap:8px; font-size:12px; } input,select { background:var(--surface); color:inherit; font:inherit; border:1px solid var(--border); border-radius:6px; padding:8px; min-width:0; max-width:100%; }
.knowledge-filters>label:first-child { flex:1 1 240px; min-width:0; }
.check-label { display:flex; align-items:center; padding:8px 0; }
.knowledge-entry { border-top:1px solid var(--border); padding:20px 0; } h3 { font-size:13px; margin:0; } p { line-height:1.7; } summary { cursor:pointer; margin:12px 0; font-size:12px; }
.text-button { white-space:normal; overflow-wrap:anywhere; text-align:left; }
.source-content { border:1px solid var(--border); padding:18px; border-radius:8px; margin-top:20px; } pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:400px; overflow:auto; } code { overflow-wrap:anywhere; font-size:10px; }
</style>
