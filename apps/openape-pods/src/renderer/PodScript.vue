<script lang="ts">
import { t, diagnostic, number } from './i18n'
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
  emits: ['changed', 'values', 'ran'],
  data() { return { awaitingRun: false, available: [] as { name: string, expression: string }[], buffer: scriptBuffer(this.pod.id), choice: '', pending: null as ScriptSelection | 'new' | 'current' | null } },
  computed: {
    dirty(): boolean { return isDirty(this.buffer) },
    readOnly(): boolean { return !this.buffer.editing || this.pod.lifecycle === 'archived' },
    canValidate(): boolean { return !this.dirty && this.buffer.source?.kind === 'draft' && !this.buffer.busy && this.pod.lifecycle !== 'archived' },
    needsCredentialApproval(): boolean { return !!this.buffer.source?.capabilities.some(item => item.startsWith('credential.')) && !this.buffer.source.credentialAccessApproved },
    canApprove(): boolean { return this.needsCredentialApproval && !this.dirty && !!this.buffer.source?.validated && !this.buffer.busy && this.pod.lifecycle !== 'archived' },
    canActivate(): boolean { return !this.needsCredentialApproval && !this.dirty && !!this.buffer.source?.validated && !!this.buffer.source.hash && this.buffer.source.hash !== this.buffer.view?.pod.activeScript && !this.buffer.busy && this.pod.lifecycle !== 'archived' },
    sourceLabel(): string { const source = this.buffer.source; return source?.kind === 'version' ? t('Version {id}', { id: source.id.slice(0, 12) }) : source ? t('Draft {id} · revision {revision}', { id: source.id.slice(0, 8), revision: source.revision }) : t('New script') },
    evidence(): string { return this.buffer.source?.evidence ? JSON.stringify(JSON.parse(this.buffer.source.evidence) as unknown, null, 2) : '' },
  },
  watch: { 'buffer.source': { handler() { this.syncChoice() } } },
  async mounted() { if (!this.buffer.busy) { if (!this.buffer.view) await this.load(); else await this.refresh(false) } this.syncChoice(); await this.loadAvailable(); if (!this.buffer.source && !this.buffer.editing && this.buffer.view) await this.open('new') },
  methods: {
    t, diagnostic, number,
    async loadAvailable() {
      try { const resources = await window.pods.resources({ type: 'list', podId: this.pod.id }); this.available = [...(resources.variables ?? []).map(item => ({ name: item.name, expression: `context.variables[${JSON.stringify(item.name)}]` })), ...resources.resources.filter(item => item.kind === 'credential' && item.state === 'ready').map(item => ({ name: item.name, expression: `await context.credentials.get(${JSON.stringify(item.name)})` }))] }
      catch (error) { this.buffer.error = error instanceof Error ? error.message : 'Could not load variables' }
    },
    async prepareRun() {
      this.awaitingRun = false
      if (this.dirty || !this.buffer.source?.validated) {
        await this.save(); if (this.buffer.error) return
        await this.validate(); if (this.buffer.error) return
      }
      if (this.needsCredentialApproval) { this.awaitingRun = true; return }
      await this.finishRun()
    },
    async approveAndRun() {
      await this.approveCredentials(); if (this.buffer.error || this.needsCredentialApproval) return
      this.awaitingRun = false; await this.finishRun()
    },
    async finishRun() {
      await this.activate(); if (this.buffer.error) return
      try { if (!this.buffer.source?.hash) throw new Error('Validate the script before running'); await window.pods.runs({ type: 'start', podId: this.pod.id, expectedScript: this.buffer.source.hash }); this.$emit('ran') }
      catch (error) { this.buffer.error = error instanceof Error ? error.message : 'Could not start run' }
    },
    syncChoice() { const source = this.buffer.source; this.choice = source ? `${source.kind}:${source.id}` : '' },
    apply(view: ScriptView) { this.buffer.view = view; this.buffer.source = view.source; this.buffer.code = view.source?.code ?? ''; this.buffer.toolCapabilities = view.source?.capabilities.filter(item => !item.startsWith('credential.')) ?? []; this.buffer.credentialAliases = view.source?.capabilities.filter(item => item.startsWith('credential.')).map(item => item.slice(11)) ?? []; this.buffer.editing = !!view.source && this.pod.lifecycle !== 'archived'; this.buffer.compare = null; this.syncChoice() },
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
    requestSelection(selection: ScriptSelection | 'new' | 'current') {
      if (this.buffer.busy) return
      if (this.dirty) { this.pending = selection; return }
      void this.open(selection)
    },
    async open(selection: ScriptSelection | 'new' | 'current') {
      if (this.buffer.busy) return
      this.pending = null; this.buffer.message = ''
      if (selection !== 'new') { await this.load(selection === 'current' ? undefined : selection); if (!this.buffer.source && this.buffer.view) await this.open('new'); return }
      this.buffer.source = null; this.buffer.code = starter; this.buffer.toolCapabilities = []; this.buffer.credentialAliases = []; this.buffer.editing = true; this.buffer.compare = null; this.syncChoice()
    },
    async save(asNew = false) {
      const state = this.buffer
      if (state.busy || !state.editing || !state.code.trim() || this.pod.lifecycle === 'archived') return
      const source = state.source
      await this.command({ type: 'save', podId: this.pod.id, revision: state.view?.pod.revision ?? this.pod.revision, draftId: !asNew && source?.kind === 'draft' ? source.id : null, draftRevision: !asNew && source?.kind === 'draft' ? source.revision : 0, code: state.code, capabilities: [...state.toolCapabilities, ...state.credentialAliases.map(alias => `credential.${alias}`)] }, 'Draft saved. Validate it before activation.')
    },
    async validate() {
      const source = this.buffer.source; if (!this.canValidate || !source) return
      await this.command({ type: 'validate', podId: this.pod.id, revision: this.buffer.view!.pod.revision, draftId: source.id, draftRevision: source.revision }, 'Synthetic sandbox check passed. Review the validated source, then activate it.')
    },
    async approveCredentials() {
      const source = this.buffer.source; if (!this.canApprove || !source?.hash) return
      await this.command({ type: 'approveCredentials', podId: this.pod.id, revision: this.buffer.view!.pod.revision, hash: source.hash, epoch: this.buffer.view!.resourceEpoch }, '')
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
    async refresh(announce = true) {
      this.buffer.busy = true; this.buffer.error = ''
      try { const view = await window.pods.scripts({ type: 'list', podId: this.pod.id }); if (!this.dirty) { this.apply(view); return } if (this.buffer.source && (view.resourceEpoch !== this.buffer.view?.resourceEpoch || view.pod.revision !== this.buffer.view?.pod.revision)) { this.buffer.source.credentialAccessApproved = false; this.buffer.source.validated = false; this.buffer.source.evidence = null } this.buffer.view = view; if (announce) this.buffer.message = 'History refreshed. Your editor text is preserved; reopen a draft to load its latest revision, or save as a new draft.' }
      catch (error) { this.buffer.error = error instanceof Error ? error.message : 'Could not refresh scripts' }
      finally { this.buffer.busy = false }
    },
    async keepChanges() { await this.refresh(false); if (!this.buffer.error) await this.save(true) },
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
  <article class="card script-panel" :aria-label="t('Script editor')">
    <div class="card-heading">
      <div>
        <h2>{{ 'run.mjs' }}</h2><p class="muted">
          {{ dirty ? t('Unsaved changes') : t('Saved locally') }}
        </p>
      </div><button class="primary" :disabled="buffer.busy || readOnly || !buffer.code.trim()" @click="prepareRun">
        {{ buffer.busy ? t('Working…') : dirty ? t('Save and run') : t('Run') }}
      </button>
    </div>
    <p v-if="buffer.error" class="error-message" role="alert">
      {{ diagnostic(buffer.error) }}
    </p><p v-if="buffer.message" role="status">
      {{ diagnostic(buffer.message) }}
    </p>
    <div v-if="pending" class="discard-prompt" role="alert">
      <p>{{ t('Discard unsaved edits and load the current script?') }}</p><button @click="open(pending)">
        {{ t('Discard and reload') }}
      </button><button @click="pending = null">
        {{ t('Keep editing') }}
      </button>
    </div>
    <div v-if="buffer.error && dirty" class="script-actions">
      <button :disabled="buffer.busy" @click="keepChanges">
        {{ t('Save my changes as current script') }}
      </button>
    </div>
    <ScriptCode v-model="buffer.code" :readonly="readOnly" :disabled="buffer.busy" @save="save()" />
    <div class="script-actions">
      <span class="muted">{{ 'JavaScript · Node.js' }}</span><button class="text-button" :disabled="readOnly || buffer.busy || !buffer.code.trim()" @click="save()">
        {{ t('Save script') }}
      </button><button class="text-button" :disabled="buffer.busy" @click="requestSelection('current')">
        {{ t('Reload script') }}
      </button>
    </div>
    <div v-if="awaitingRun" class="discard-prompt" role="alert">
      <p>{{ t('Review secret access before this script runs.') }}</p><button class="primary" :disabled="!canApprove" @click="approveAndRun">
        {{ t('Review credential access') }}
      </button><button class="text-button" @click="awaitingRun = false">
        {{ t('Cancel') }}
      </button>
    </div>
    <details class="script-references">
      <summary>{{ t('Available variables and secrets') }}</summary>
      <p><code>{{ 'context.workspace' }}</code> · {{ t('Writable workspace') }}</p><p><code>{{ 'context.references' }}</code> · {{ t('Read-only references') }}</p><p><code>{{ 'context.input' }}</code> · {{ t('Run inputs and progress') }}</p>
      <div v-for="item in available" :key="item.name" class="reference-expression">
        <strong>{{ item.name }}</strong><input readonly :aria-label="item.name" :value="item.expression" @focus="($event.target as HTMLInputElement).select()">
      </div>
      <p class="muted">
        {{ t('Values are not automatically sent to AI. Secrets remain hidden here.') }}
      </p><button class="text-button" @click="$emit('values')">
        {{ t('Manage variables and secrets') }}
      </button>
    </details>
  </article>
</template>

<style scoped>
.script-capability { display:flex;gap:8px;align-items:flex-start;overflow-wrap:anywhere;min-width:0;margin:12px 0; }
.script-capability input { flex-shrink:0; }
.script-panel { margin-top:20px; min-width:0; }
.script-panel p { margin:10px 0; }
.script-tools, .script-actions, .script-heading { display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin:16px 0; }
.script-tools label { display:grid; gap:6px; min-width:0; flex:1; }
select { width:100%; min-width:0; padding:9px; font:inherit; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:8px; }
.script-heading { justify-content:space-between; }
fieldset { min-width:0; }
.capability { overflow-wrap:anywhere; display:flex; align-items:flex-start; gap:8px; font-size:13px; margin:16px 0; }
.source-preview { max-height:360px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.6 ui-monospace, monospace; background:var(--surface); padding:14px; border:1px solid var(--border); border-radius:8px; }
.script-hash { font:11px/1.6 ui-monospace, monospace; overflow-wrap:anywhere; color:var(--muted); }
.discard-prompt { border:1px solid var(--accent); padding:12px; border-radius:8px; } .discard-prompt button { margin-right:8px; }
summary { cursor:pointer; font-size:13px; }
@media (max-width:640px) { .script-tools label { flex-basis:100%; } }
</style>
