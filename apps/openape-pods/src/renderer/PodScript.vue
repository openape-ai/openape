<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { ScriptCommand, ScriptSelection, ScriptView } from '../contracts/scripts'
import { isDirty, scriptBuffer } from './script-buffer'
import ScriptCode from './ScriptCode.vue'

const starter = `export async function run(context) {
  context.log('Starting pod script')
  return {
    status: 'completed',
    summary: 'Pod script completed',
    completedInputIds: context.input.eventIds,
    gapIds: [],
  }
}
`
export default defineComponent({
  components: { ScriptCode },
  props: { pod: { type: Object as PropType<StoredPod>, required: true } },
  emits: ['changed'],
  data() { return { buffer: scriptBuffer(this.pod.id), choice: '', pending: null as ScriptSelection | 'new' | null } },
  computed: {
    dirty(): boolean { return isDirty(this.buffer) },
    readOnly(): boolean { return !this.buffer.editing || this.pod.lifecycle === 'archived' },
    canValidate(): boolean { return !this.dirty && this.buffer.source?.kind === 'draft' && !this.buffer.busy && this.pod.lifecycle !== 'archived' },
    canActivate(): boolean { return !this.dirty && !!this.buffer.source?.validated && !!this.buffer.source.hash && this.buffer.source.hash !== this.buffer.view?.pod.activeScript && !this.buffer.busy && this.pod.lifecycle !== 'archived' },
    sourceLabel(): string { const source = this.buffer.source; return source?.kind === 'version' ? `Version ${source.id.slice(0, 12)}` : source ? `Draft ${source.id.slice(0, 8)} · revision ${source.revision}` : 'New script' },
    evidence(): string { return this.buffer.source?.evidence ? JSON.stringify(JSON.parse(this.buffer.source.evidence) as unknown, null, 2) : '' },
  },
  watch: { 'buffer.source': { handler() { this.syncChoice() } } },
  async mounted() { if (!this.buffer.view && !this.buffer.busy) await this.load(); this.syncChoice() },
  methods: {
    syncChoice() { const source = this.buffer.source; this.choice = source ? `${source.kind}:${source.id}` : '' },
    apply(view: ScriptView) { this.buffer.view = view; this.buffer.source = view.source; this.buffer.code = view.source?.code ?? ''; this.buffer.mail = view.source?.capabilities.includes('mail.read') ?? false; this.buffer.editing = view.source?.kind === 'draft'; this.buffer.compare = null; this.syncChoice() },
    async load(selection?: ScriptSelection) {
      this.buffer.busy = true; this.buffer.error = ''
      try { this.apply(await window.pods.scripts({ type: 'list', podId: this.pod.id, ...(selection ? { selection } : {}) })) }
      catch (error) { this.buffer.error = error instanceof Error ? error.message : 'Could not load script' }
      finally { this.buffer.busy = false; this.syncChoice() }
    },
    choose() {
      const [kind, id] = this.choice.split(':')
      if (kind !== 'version' && kind !== 'draft') return
      this.requestSelection({ kind, id }); this.syncChoice()
    },
    requestSelection(selection: ScriptSelection | 'new') {
      if (this.buffer.busy) return
      if (this.dirty) { this.pending = selection; return }
      void this.open(selection)
    },
    async open(selection: ScriptSelection | 'new') {
      if (this.buffer.busy) return
      this.pending = null; this.buffer.message = ''
      if (selection !== 'new') { await this.load(selection); return }
      this.buffer.source = null; this.buffer.code = starter; this.buffer.mail = false; this.buffer.editing = true; this.buffer.compare = null; this.syncChoice()
    },
    async save(asNew = false) {
      const state = this.buffer
      if (state.busy || !state.editing || !state.code.trim() || this.pod.lifecycle === 'archived') return
      const source = state.source
      await this.command({ type: 'save', podId: this.pod.id, revision: state.view?.pod.revision ?? this.pod.revision, draftId: !asNew && source?.kind === 'draft' ? source.id : null, draftRevision: !asNew && source?.kind === 'draft' ? source.revision : 0, code: state.code, capabilities: state.mail ? ['mail.read'] : [] }, 'Draft saved. Validate it before activation.')
    },
    async validate() {
      const source = this.buffer.source; if (!this.canValidate || !source) return
      await this.command({ type: 'validate', podId: this.pod.id, revision: this.buffer.view!.pod.revision, draftId: source.id, draftRevision: source.revision }, 'Synthetic sandbox check passed. Review the validated source, then activate it.')
    },
    async activate() {
      const source = this.buffer.source; if (!this.canActivate || !source?.hash) return
      await this.command({ type: 'activate', podId: this.pod.id, revision: this.buffer.view!.pod.revision, hash: source.hash, expectedActive: this.buffer.view!.pod.activeScript }, 'Activated for the next run. Existing runs retain their pinned version.')
      this.$emit('changed')
    },
    async command(command: ScriptCommand, message: string) {
      this.buffer.busy = true; this.buffer.error = ''; this.buffer.message = ''
      try { this.apply(await window.pods.scripts(command)); this.buffer.message = message }
      catch (error) { this.buffer.error = error instanceof Error ? error.message : 'Script operation failed' }
      finally { this.buffer.busy = false }
    },
    async refresh() {
      this.buffer.busy = true; this.buffer.error = ''
      try { const view = await window.pods.scripts({ type: 'list', podId: this.pod.id }); this.buffer.view = view; this.buffer.message = 'History refreshed. Your editor text is preserved; reopen a draft to load its latest revision, or save as a new draft.' }
      catch (error) { this.buffer.error = error instanceof Error ? error.message : 'Could not refresh scripts' }
      finally { this.buffer.busy = false }
    },
    async compare() {
      const active = this.buffer.view?.pod.activeScript; if (!active) return
      this.buffer.busy = true; this.buffer.error = ''
      try { const view = await window.pods.scripts({ type: 'list', podId: this.pod.id, selection: { kind: 'version', id: active } }); this.buffer.compare = view.source!.code }
      catch (error) { this.buffer.error = error instanceof Error ? error.message : 'Could not load comparison' }
      finally { this.buffer.busy = false }
    },
  },
})
</script>

<template>
  <article class="card script-panel" aria-label="Script editor">
    <div class="card-heading">
      <div>
        <h2>Script</h2><p class="muted">
          JavaScript · Node.js · run.mjs
        </p>
      </div><span class="badge">{{ dirty ? 'Unsaved changes' : buffer.editing && buffer.source?.kind === 'version' ? 'Editing copy' : buffer.source?.hash === buffer.view?.pod.activeScript && buffer.source?.hash ? 'Active version' : buffer.source?.validated ? 'Validated' : 'Draft' }}</span>
    </div>
    <p class="muted">
      Inspect the exact version used by this pod, or edit a draft for its next run.
    </p>
    <div class="script-tools">
      <label>Versions and drafts<select v-model="choice" :disabled="buffer.busy" @change="choose"><option value="" disabled>Select a script</option><optgroup label="Versions"><option v-for="version in buffer.view?.versions" :key="version.hash" :value="`version:${version.hash}`">{{ version.active ? 'Active · ' : '' }}{{ version.hash.slice(0, 12) }} · {{ version.validated ? 'validated' : 'needs validation' }}</option></optgroup><optgroup label="Drafts"><option v-for="draft in buffer.view?.drafts" :key="draft.id" :value="`draft:${draft.id}`">{{ draft.id.slice(0, 8) }} · revision {{ draft.revision }}</option></optgroup></select></label>
      <button class="secondary" :disabled="buffer.busy || pod.lifecycle === 'archived'" @click="requestSelection('new')">
        New script
      </button><button class="text-button" :disabled="buffer.busy" @click="refresh">
        Refresh history
      </button>
    </div>
    <div v-if="pending" class="discard-prompt" role="alert">
      <p>Discard unsaved edits and open the selected script?</p><button class="secondary" @click="open(pending)">
        Discard edits
      </button><button class="primary" @click="pending = null">
        Keep editing
      </button>
    </div>
    <button v-if="buffer.source" class="text-button" :disabled="buffer.busy" @click="requestSelection({ kind: buffer.source.kind, id: buffer.source.id })">
      Reload selected source
    </button>
    <p v-if="buffer.error" class="error-message" role="alert">
      {{ buffer.error }}
    </p><p v-if="buffer.message" role="status">
      {{ buffer.message }}
    </p>
    <template v-if="buffer.source || buffer.editing">
      <div class="script-heading">
        <strong>{{ sourceLabel }}</strong><button v-if="readOnly && pod.lifecycle !== 'archived'" class="secondary" :disabled="buffer.busy" @click="buffer.editing = true">
          Edit as draft
        </button>
      </div>
      <div class="script-actions">
        <button class="primary" :disabled="readOnly || buffer.busy || !buffer.code.trim()" @click="save()">
          Save draft
        </button><button v-if="buffer.source?.kind === 'draft' && buffer.editing" class="text-button" :disabled="buffer.busy || pod.lifecycle === 'archived'" @click="save(true)">
          Save as new draft
        </button><button class="secondary" :disabled="!canValidate" @click="validate">
          {{ buffer.busy ? 'Working…' : 'Validate draft' }}
        </button><button class="primary" :disabled="!canActivate" @click="activate">
          Activate for next run
        </button>
      </div>
      <ScriptCode v-model="buffer.code" :readonly="readOnly" :disabled="buffer.busy" @save="save()" />
      <p class="muted">
        {{ buffer.code.split('\n').length }} lines · {{ buffer.code.length.toLocaleString() }} / 150,000 characters{{ dirty ? ' · Save before quitting. Edits are kept while navigating this app session.' : '' }}
      </p>
      <label class="capability"><input v-model="buffer.mail" type="checkbox" :disabled="readOnly || buffer.busy">Declare read-only mail calls (requires assigned mail permissions)</label>

      <p class="muted">
        Validation runs for up to five seconds in the sandbox with synthetic services. It does not prove real mail or model results. Activation keeps existing permissions and leaves running versions unchanged.
      </p>
      <details v-if="evidence">
        <summary>Validation details</summary><pre class="source-preview">{{ evidence }}</pre><button v-if="buffer.source?.kind === 'draft' && buffer.source.hash" class="text-button" :disabled="buffer.busy || dirty" @click="requestSelection({ kind: 'version', id: buffer.source.hash })">
          View exact validated source
        </button>
      </details>
      <div class="script-actions">
        <button class="text-button" :disabled="buffer.busy || !buffer.view?.pod.activeScript" @click="compare">
          Compare with active version
        </button>
      </div>
      <details v-if="buffer.compare !== null" open>
        <summary>Active version for comparison</summary><p class="muted">
          The editor above contains your selected source; this is the currently active source.
        </p><pre class="source-preview">{{ buffer.compare }}</pre>
      </details>
      <p v-if="buffer.source?.hash" class="script-hash">
        {{ buffer.editing ? 'Base source SHA-256' : 'SHA-256' }} · {{ buffer.source.hash }}
      </p>
    </template>
    <p v-else class="muted">
      No script yet. Choose New script to start locally, or ask the master to prepare a draft.
    </p>
  </article>
</template>

<style scoped>
.script-panel { margin-top:20px; min-width:0; }
.script-panel p { margin:10px 0; }
.script-tools, .script-actions, .script-heading { display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin:16px 0; }
.script-tools label { display:grid; gap:6px; min-width:0; flex:1; }
select { width:100%; min-width:0; padding:9px; font:inherit; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:8px; }
.script-heading { justify-content:space-between; }
.capability { display:flex; align-items:flex-start; gap:8px; font-size:13px; margin:16px 0; }
.source-preview { max-height:360px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.6 ui-monospace, monospace; background:var(--surface); padding:14px; border:1px solid var(--border); border-radius:8px; }
.script-hash { font:11px/1.6 ui-monospace, monospace; overflow-wrap:anywhere; color:var(--muted); }
.discard-prompt { border:1px solid var(--accent); padding:12px; border-radius:8px; } .discard-prompt button { margin-right:8px; }
summary { cursor:pointer; font-size:13px; }
@media (max-width:640px) { .script-tools label { flex-basis:100%; } }
</style>
