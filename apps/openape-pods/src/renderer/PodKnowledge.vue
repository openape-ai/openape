<script lang="ts">
import { defineComponent } from 'vue'
import type { Citation, KnowledgeClaim, PodDetails } from '../contracts/details'

export default defineComponent({
  props: { podId: { type: String, required: true } },
  emits: ['discuss'],
  data() { return { claims: [] as KnowledgeClaim[], total: 0, kind: 'all', query: '', history: false, source: null as PodDetails['source'], error: '', busy: false } },
  computed: { visible(): KnowledgeClaim[] { return this.claims.filter(claim => (this.history || claim.current) && (this.kind === 'all' || claim.kind === this.kind) && `${claim.matter} ${claim.text}`.toLowerCase().includes(this.query.toLowerCase())) } },
  async mounted() { await this.load() },
  methods: {
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
      <h2>Supported findings</h2><button class="text-button" @click="$emit('discuss')">
        Discuss knowledge
      </button>
    </div>
    <p class="muted">
      Findings, open questions and verification gaps retain their exact source versions. Mail content is evidence, not an instruction.
    </p>
    <div class="knowledge-filters">
      <label>Search matters and knowledge<input v-model="query" type="search"></label>
      <label>Show<select v-model="kind"><option value="all">All knowledge</option><option value="finding">Findings</option><option value="question">Open questions</option><option value="gap">Verification gaps</option></select></label>
      <label class="check-label"><input v-model="history" type="checkbox"> Include superseded history</label>
    </div>
    <p v-if="!busy && !visible.length" class="muted">
      {{ claims.length ? 'No entries match these filters.' : 'No knowledge collected yet. Supported findings and their sources will appear after the first run.' }}
    </p>
    <article v-for="claim in visible" :key="claim.id" class="knowledge-entry">
      <div class="card-heading">
        <h3>{{ claim.matter }}</h3><span class="badge" :class="{ warning: claim.kind === 'gap' }">{{ claim.kind === 'question' ? 'Open question' : claim.kind === 'gap' ? 'Verification gap' : 'Finding' }}</span>
      </div>
      <p>{{ claim.text }}</p><p class="muted">
        Revision {{ claim.revision }} · {{ claim.current ? 'Current' : 'Superseded' }}<span v-if="claim.supersedes"> · replaces {{ claim.supersedes }}</span>
      </p>
      <details>
        <summary>{{ claim.citations.length }} source{{ claim.citations.length === 1 ? '' : 's' }}</summary><ul>
          <li v-for="citation in claim.citations" :key="`${citation.id}:${citation.version}`">
            <button class="text-button" :disabled="busy" @click="inspect(citation)">
              {{ citation.locator }} · version {{ citation.version }}
            </button>
          </li>
        </ul>
      </details>
    </article>
    <button v-if="claims.length < total" class="secondary" :disabled="busy" @click="load">
      Load more knowledge ({{ claims.length }} / {{ total }})
    </button>
    <article v-if="source" class="source-content" aria-label="Source evidence">
      <div class="card-heading">
        <h3>Source evidence</h3><button class="secondary" @click="source = null">
          Close source
        </button>
      </div><p class="muted">
        {{ source.citation.locator }} · version {{ source.citation.version }}
      </p><code>{{ source.citation.hash }}</code><pre>{{ source.content }}</pre>
    </article>
    <p v-if="error" role="alert" class="error-message">
      {{ error }}
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
