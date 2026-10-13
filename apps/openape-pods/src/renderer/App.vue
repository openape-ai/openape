<script lang="ts">
import { usePodAccess } from './pod-access'
import { t, diagnostic, label, dateTime } from './i18n'
import { defineComponent } from 'vue'
import WorkspaceFrame from './WorkspaceFrame.vue'
import AppSettings from './AppSettings.vue'
import LocalShell from './central/LocalShell.vue'
import SharingImport from './SharingImport.vue'
import SharingExport from './SharingExport.vue'
import type { PortableSourceSelection, SharingCommand } from '../contracts/sharing'
import type { Organization } from '../contracts/groups'
import AccountStatus from './AccountStatus.vue'
import PodDescription from './PodDescription.vue'
import PodScript from './PodScript.vue'
import PodSettings from './PodSettings.vue'
import PodValues from './PodValues.vue'
import PodResources from './PodResources.vue'
import PodRuns from './PodRuns.vue'
import type { RunApproval as Approval } from '../contracts/activity'
import PodKnowledge from './PodKnowledge.vue'
import TagEditor from './central/TagEditor.vue'
import type { CentralCommand } from '../contracts/central'
import type { MapTags } from '../contracts/map-view'
import type { ItemTags, StoredPod, WorkspaceState } from '../contracts/control'
import type { PodDetails } from '../contracts/details'
import type { RunRecord } from '../contracts/runs'
import type { ScheduleView } from '../contracts/scheduling'
import type { PodStatus } from '../contracts/ipc'

export default defineComponent({
  components: { WorkspaceFrame, AppSettings, LocalShell, SharingImport, SharingExport, AccountStatus, PodDescription, PodScript, PodSettings, PodValues, PodResources, PodRuns, PodKnowledge, TagEditor },
  props: { embedded: Boolean, initialPodId: { type: String, default: '' }, refreshToken: { type: Number, default: 0 } },
  emits: ['settings'],
  setup() { return { access: usePodAccess() } },
  data() {
    return { sharing: typeof window.pods?.sharing === 'function', shareSelection: null as PortableSourceSelection | null, requestedRun: '', requestedSecret: '', approvals: [] as (Approval & { runId: string })[], organization: { revision: 1, groups: [] } as Organization, selected: this.initialPodId ? 'Overview' : 'Pods', sections: ['runs', 'values', 'access', 'settings', 'code'], tags: [] as ItemTags[], codeOpen: false, pods: [] as StoredPod[], podId: this.initialPodId, creating: false, details: null as PodDetails | null, runs: [] as RunRecord[], schedule: null as ScheduleView | null, resourceCount: 0, status: null as PodStatus | null, connectionError: '', dataError: '', busy: false, setupChecked: false, closed: false, timer: null as ReturnType<typeof setTimeout> | null, unsubscribe: null as (() => void) | null }
  },
  computed: {
    globalPage(): boolean { return ['App settings', 'Pods', 'Import', 'Share'].includes(this.selected) },
    sharingApi(): (command: SharingCommand) => Promise<import('../contracts/sharing').SharingState> { return command => window.pods.sharing!(command) },
    pod(): StoredPod | undefined { return this.pods.find(pod => pod.id === this.podId) },
    podTags(): MapTags { const item = this.tags.find(entry => entry.id === this.podId); return item ? { own: item.tags, revision: item.revision } : { own: [], revision: 0 } },
    tagSuggestions(): string[] { return [...new Set(this.tags.flatMap(item => item.tags))].sort() },
    workerLabel(): string { if (this.connectionError) return t('Unavailable'); return label({ starting: 'Starting', ready: 'Ready', recovery: 'Needs attention', error: 'Needs attention', stopped: 'Stopped' }[this.status?.worker.state ?? 'starting']) },
    attention(): boolean { return !!this.connectionError || this.status?.worker.state === 'error' },
    currentRun(): RunRecord | undefined { return this.runs.find(run => run.state === 'running') },
    needsRecovery(): boolean { const run = this.runs[0]; return !this.schedule?.retry && !!run && ['interrupted', 'failed', 'cancelled', 'blocked'].includes(run.state) && run.recovery?.state !== 'retryQueued' },
    nextRun(): string { if (!this.pod || this.pod.lifecycle !== 'active' || !this.schedule?.enabled) return t('Manual only'); return this.schedule.nextAt ? t('Next run: {time}', { time: dateTime(this.schedule.nextAt) }) : t('No scheduled time') },
  },
  watch: { refreshToken() { void this.refresh() } },
  async mounted() {
    try { if (this.access.remote) { await this.refresh(); return }; this.unsubscribe = window.pods.onStatus((status) => { this.status = status }); this.status = await window.pods.getStatus(); await this.refresh() }
    catch (error) { this.connectionError = error instanceof Error ? error.message : 'Could not reach the desktop worker' }
    this.poll()
  },
  beforeUnmount() { this.closed = true; this.unsubscribe?.(); if (this.timer) clearTimeout(this.timer) },
  methods: {
    navigate(page: string) { if (this.embedded && page === 'App settings') { this.$emit('settings'); return }; this.selected = page },
    share(selection: PortableSourceSelection) { this.shareSelection = selection; this.selected = 'Share' },
    podResources(podId: string) { return window.pods.resources({ type: 'list', podId }) },
    t, diagnostic, label, dateTime,
    sectionTitle(section: string): string { return ({ runs: t('Runs'), values: t('Variables and secrets'), access: t('Access'), settings: t('Settings'), code: t('Code') } as Record<string, string>)[section] ?? section },
    async openRun(podId: string, runId: string) { await this.selectPod(podId); this.requestedRun = runId; this.goTo('runs') },
    openValues(alias = '') { this.requestedSecret = alias; this.goTo('values') },
    /** The Pod page is one scrolling page; section links jump instead of switching tabs. */
    goTo(section: string) { this.selected = 'Overview'; if (section === 'code') this.codeOpen = true; void this.$nextTick(() => document.getElementById(`section-${section}`)?.scrollIntoView({ block: 'start' })) },
    async saveTags(command: CentralCommand) {
      try { await this.access.api.workspace(command.body as Parameters<typeof this.access.api.workspace>[0]); await this.refresh() }
      catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not save tags' }
    },
    async openFolder() {
      if (this.pod && !this.access.remote) {
        try { await window.pods.programs({ type: 'openFolder', podId: this.pod.id }) }
        catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not open folder' }
      }
    },
    workspaceChanged(state: WorkspaceState) { if (state.organization.revision < this.organization.revision) return; this.pods = state.pods; this.organization = state.organization; this.tags = state.tags ?? [] },
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { await this.refresh(); this.poll() }, 1000) },
    async refresh() {
      if (this.busy || (!this.access.remote && this.status?.worker.state !== 'ready')) return
      this.busy = true
      try {
        this.workspaceChanged(await this.access.api.workspace({ type: 'list' }))
        if (!this.pods.some(pod => pod.id === this.podId)) this.podId = this.creating || this.embedded ? '' : this.pods[0]?.id ?? ''
        const id = this.podId
        if (!id) { this.details = null; this.runs = []; this.schedule = null; this.resourceCount = 0; return }
        const [details, runs, schedule, resources] = await Promise.all([this.access.api.details({ type: 'list', podId: id }), this.access.api.runs({ type: 'list', podId: id }), this.access.api.scheduling({ type: 'list', podId: id }), this.access.api.resources({ type: 'list', podId: id })])
        if (this.podId !== id) return
        this.details = details; this.runs = runs.runs; this.approvals = runs.approvals ?? []; this.schedule = schedule; this.resourceCount = resources.resources.filter(resource => resource.state === 'ready').length; this.dataError = ''
      }
      catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not load workspace' }
      finally { this.busy = false }
    },
    async selectPod(id: string) { this.requestedRun = ''; this.requestedSecret = ''; this.podId = id; this.approvals = []; this.creating = false; this.details = null; this.runs = []; this.schedule = null; this.codeOpen = false; this.selected = 'Overview'; await this.refresh() },
    async changed(id: string) { if (this.creating && id) this.selected = 'Overview'; this.podId = id; this.creating = !id; await this.refresh() },
    async runOnce() {
      if (!this.pod) return; try { await this.access.api.runs({ type: 'start', podId: this.pod.id, expectedScript: this.pod.activeScript ?? undefined }); await this.refresh(); this.goTo('runs') }
      catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not start run' }
    },
    async pause() {
      if (!this.pod) return
      try { await this.access.api.scheduling({ type: 'lifecycle', podId: this.pod.id, revision: this.pod.revision, lifecycle: this.pod.lifecycle === 'active' ? 'paused' : 'active' }); await this.refresh() }
      catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not change lifecycle' }
    },
  },
})
</script>

<template>
  <WorkspaceFrame :embedded="embedded">
    <template #account>
      <AccountStatus :available="status?.worker.state === 'ready'" @open="navigate('App settings')" />
    </template>
    <template #status>
      <span class="muted" role="status">{{ workerLabel }}</span>
    </template>
    <div class="main">
      <div class="window-drag" /><div class="content">
        <button v-if="selected !== 'Pods' && !embedded" class="text-button" data-testid="back-to-automations" @click="selected = 'Pods'">
          ‹ {{ t('Automations') }}
        </button>
        <div v-if="!globalPage" class="page-heading">
          <h1>{{ creating ? t('New pod') : pod?.name ?? t('Your pods') }}</h1><span v-if="pod" class="muted">{{ nextRun }}</span><button v-if="sharing && pod" class="secondary" @click="share({ kind: 'pod', id: pod.id })">
            {{ t('Share') }}
          </button>
        </div>
        <div v-if="attention" class="fixture-note">
          <strong role="status">{{ workerLabel }}</strong><p role="alert">
            {{ diagnostic(connectionError || status?.worker.error) }}
          </p>
        </div>
        <p v-if="dataError" role="alert" class="error-message">
          {{ diagnostic(dataError) }}
        </p>
        <nav v-if="!globalPage && !creating && pod && selected !== 'Knowledge'" class="section-links" :aria-label="t('Pod sections')">
          <button v-for="section in sections" :key="section" class="link" type="button" @click="goTo(section)">
            {{ sectionTitle(section) }}
          </button>
        </nav>
        <AppSettings v-if="selected === 'App settings'" />
        <LocalShell v-else-if="selected === 'Pods'" :sharing="sharing" @open-pod="selectPod" @share="share" @advanced="navigate('App settings')" @import="selected = 'Import'" />
        <template v-else-if="selected === 'Import'">
          <SharingImport :api="sharingApi" desktop :resources="podResources" @changed="refresh" @open-pod="selectPod" />
        </template>
        <template v-else-if="selected === 'Share' && shareSelection">
          <SharingExport :key="shareSelection.id" :selection="shareSelection" :api="sharingApi" @done="selected = 'Pods'" />
        </template>
        <section v-else-if="selected === 'Knowledge'" class="pod-section">
          <button class="text-button" @click="selected = 'Overview'">
            {{ t('Back to overview') }}
          </button><PodKnowledge v-if="pod" :key="podId" :pod-id="podId" @discuss="navigate('App settings')" />
        </section>
        <PodSettings v-else-if="creating" :selected-pod-id="podId" @selected="changed" @accounts="navigate('App settings')" />
        <template v-else-if="pod">
          <section id="section-overview" class="pod-section">
            <PodDescription :key="pod.id" :pod-id="pod.id" />
            <article class="card pod-tags">
              <h2>{{ t('Tags') }}</h2>
              <TagEditor :id="pod.id" :key="`${pod.id}:${podTags.revision}`" :tags="podTags" :suggestions="tagSuggestions" @command="saveTags" />
            </article>
            <div class="overview-actions">
              <button v-if="needsRecovery && !currentRun" class="primary" @click="goTo('runs')">
                {{ t('Prepare retry') }}
              </button>
              <button v-else class="primary" :disabled="!pod.activeScript || !!currentRun || !!schedule?.retry || pod.lifecycle === 'archived' || attention" @click="runOnce">
                {{ t('Run now') }}
              </button>
              <button v-if="pod.lifecycle !== 'archived'" class="secondary" @click="pause">
                {{ pod.lifecycle === 'active' ? t('Pause') : t('Resume') }}
              </button>
              <button v-if="!access.remote" class="text-button" @click="selected = 'Knowledge'">
                {{ t('Results and sources') }}
              </button>
              <span v-if="!pod.activeScript" class="muted">{{ t('Prepare the script before its first run.') }}</span><span v-else-if="currentRun" class="muted">{{ t('A run is active') }}</span>
            </div>
            <p v-if="schedule?.retry" role="status">
              {{ t('Waiting for service recovery. Next attempt: {time}', { time: dateTime(schedule.retry.at) }) }}
            </p>
          </section>
          <section id="section-runs" class="pod-section">
            <h2 class="section-title">
              {{ t('Runs') }}
            </h2>
            <PodRuns :key="`${podId}:${requestedRun}`" :selected-run-id="requestedRun" :selected-pod-id="podId" @navigate="$event === 'identity' ? goTo('settings') : $event === 'settings' ? navigate('App settings') : goTo('access')" />
          </section>
          <section id="section-values" class="pod-section">
            <h2 class="section-title">
              {{ t('Variables and secrets') }}
            </h2>
            <PodValues :key="podId" :pod-id="podId" :requested-secret="requestedSecret" />
          </section>
          <section id="section-access" class="pod-section">
            <h2 class="section-title">
              {{ t('Access') }}
            </h2>
            <PodResources :key="podId" :selected-pod-id="podId" @discuss="navigate('App settings')" />
          </section>
          <section id="section-settings" class="pod-section">
            <h2 class="section-title">
              {{ t('Settings') }}
            </h2>
            <PodSettings :key="podId" :selected-pod-id="podId" @selected="changed" @accounts="navigate('App settings')" />
          </section>
          <section id="section-code" class="pod-section">
            <details class="code-section" :open="codeOpen" @toggle="codeOpen = ($event.target as HTMLDetailsElement).open">
              <summary>{{ t('Code') }}</summary>
              <button v-if="!access.remote" class="secondary" type="button" @click="openFolder">
                {{ t('Open in editor') }}
              </button>
              <PodScript v-if="codeOpen" :key="podId" :pod="pod" @changed="refresh" @values="openValues" @ran="refresh(); goTo('runs')" />
            </details>
          </section>
        </template>
        <article v-else class="card empty-panel">
          <h2>{{ t('No pods yet') }}</h2><p class="muted">
            {{ t('Create your first Pod from the Automations tab: hand a brief to Codex.') }}
          </p>
        </article>
      </div>
    </div>
  </WorkspaceFrame>
</template>
