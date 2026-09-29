<script lang="ts">
import { usePodAccess } from './pod-access'
import { t, diagnostic, label, dateTime } from './i18n'
import { defineComponent } from 'vue'
import WorkspaceFrame from './WorkspaceFrame.vue'
import AppSettings from './AppSettings.vue'
import PodInventory from './PodInventory.vue'
import GraphPanel from './GraphPanel.vue'
import type { WorkflowView } from '../contracts/workflows'
import type { Organization } from '../contracts/groups'
import DataManagement from './DataManagement.vue'
import Onboarding from './Onboarding.vue'
import AccountStatus from './AccountStatus.vue'
import PodDescription from './PodDescription.vue'
import PodScript from './PodScript.vue'
import PodSettings from './PodSettings.vue'
import PodValues from './PodValues.vue'
import PodResources from './PodResources.vue'
import PodRuns from './PodRuns.vue'
import { runFailure, runHeadline } from './run-activity'
import RunApproval from './RunApproval.vue'
import type { RunApproval as Approval } from '../contracts/activity'
import PodKnowledge from './PodKnowledge.vue'
import type { StoredPod, WorkspaceState } from '../contracts/control'
import type { PodDetails } from '../contracts/details'
import type { RunRecord } from '../contracts/runs'
import type { ScheduleView } from '../contracts/scheduling'
import type { PodStatus } from '../contracts/ipc'

export default defineComponent({
  components: { WorkspaceFrame, AppSettings, PodInventory, GraphPanel, AccountStatus, RunApproval, PodDescription, DataManagement, Onboarding, PodScript, PodSettings, PodValues, PodResources, PodRuns, PodKnowledge },
  props: { embedded: Boolean, initialPodId: { type: String, default: '' }, refreshToken: { type: Number, default: 0 } },
  emits: ['settings'],
  setup() { return { access: usePodAccess() } },
  data() {
    return { requestedRun: '', workflowId: '', workflows: { workflows: [], runs: [] } as WorkflowView, requestedSecret: '', approvals: [] as (Approval & { runId: string })[], organization: { revision: 1, groups: [] } as Organization, selected: this.initialPodId ? 'Overview' : 'Workflows', tabs: ['Overview', 'Script', 'Values', 'Permissions', 'Settings', 'History'], pods: [] as StoredPod[], podId: this.initialPodId, creating: false, details: null as PodDetails | null, runs: [] as RunRecord[], schedule: null as ScheduleView | null, resourceCount: 0, status: null as PodStatus | null, connectionError: '', dataError: '', busy: false, setupChecked: false, closed: false, timer: null as ReturnType<typeof setTimeout> | null, unsubscribe: null as (() => void) | null }
  },
  computed: {
    framePage(): string { return ['App settings', 'Setup', 'Data'].includes(this.selected) ? 'App settings' : this.selected === 'Workflows' ? 'Workflows' : 'Pods' },
    activeTab(): string { return this.selected === 'Knowledge' ? 'Overview' : this.selected },
    globalPage(): boolean { return ['App settings', 'Setup', 'Data', 'Workflows', 'Pods'].includes(this.selected) },
    pod(): StoredPod | undefined { return this.pods.find(pod => pod.id === this.podId) },
    workerLabel(): string { if (this.connectionError) return t('Unavailable'); return label({ starting: 'Starting', ready: 'Ready', error: 'Needs attention', stopped: 'Stopped' }[this.status?.worker.state ?? 'starting']) },
    attention(): boolean { return !!this.connectionError || this.status?.worker.state === 'error' },
    currentRun(): RunRecord | undefined { return this.runs.find(run => run.state === 'running') },
    needsRecovery(): boolean { const run = this.runs[0]; return !this.schedule?.retry && !!run && ['interrupted', 'failed', 'cancelled', 'blocked'].includes(run.state) && run.recovery?.state !== 'retryQueued' },
    nextRun(): string { if (!this.pod || this.pod.lifecycle !== 'active' || !this.schedule?.enabled) return t('Manual only'); return this.schedule.nextAt ? dateTime(this.schedule.nextAt) : t('No scheduled time') },
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
    t, runFailure, runHeadline, diagnostic, label, dateTime,
    async openRun(podId: string, runId: string) { await this.selectPod(podId); this.requestedRun = runId; this.selected = 'History' },
    openValues(alias = '') { this.requestedSecret = alias; this.selected = 'Values' },
    workspaceChanged(state: WorkspaceState) { if (state.organization.revision < this.organization.revision) return; this.pods = state.pods; this.organization = state.organization },
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { await this.refresh(); this.poll() }, 1000) },
    async refresh() {
      if (this.busy || (!this.access.remote && this.status?.worker.state !== 'ready')) return
      this.busy = true
      try {
        const [workspace, workflows] = await Promise.all([this.access.api.workspace({ type: 'list' }), this.access.api.workflows({ type: 'list' })])
        this.workspaceChanged(workspace); this.workflows = workflows
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
    async selectPod(id: string) { this.requestedRun = ''; this.requestedSecret = ''; this.podId = id; this.approvals = []; this.creating = false; this.details = null; this.runs = []; this.schedule = null; this.selected = 'Overview'; await this.refresh() },
    async changed(id: string) { if (this.creating && id) this.selected = 'Overview'; this.podId = id; this.creating = !id; await this.refresh() },
    async selectTab(tab: string) { await this.refresh(); this.selected = tab },
    createPod() { this.creating = true; this.podId = ''; this.selected = 'Settings' },
    async runOnce() {
      if (!this.pod) return; try { await this.access.api.runs({ type: 'start', podId: this.pod.id, expectedScript: this.pod.activeScript ?? undefined }); this.selected = 'History'; await this.refresh() }
      catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not start run' }
    },
    async pause() {
      if (!this.pod) return
      try { await this.access.api.scheduling({ type: 'lifecycle', podId: this.pod.id, revision: this.pod.revision, lifecycle: this.pod.lifecycle === 'active' ? 'paused' : 'active' }); await this.refresh() }
      catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not change lifecycle' }
    },
    moveTab(event: KeyboardEvent, index: number) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length
      const tab = this.tabs[next]
      if (tab) this.selected = tab
      ;(this.$refs.tabButtons as HTMLButtonElement[])[next]?.focus()
    },
  },
})
</script>

<template>
  <WorkspaceFrame :page="framePage" :count="pods.filter(item => item.lifecycle !== 'archived').length" :embedded="embedded" @navigate="navigate">
    <template #account>
      <AccountStatus :available="status?.worker.state === 'ready'" @open="navigate('App settings')" />
    </template>
    <template #status>
      <span class="muted" role="status">{{ workerLabel }}</span>
    </template>
    <div class="main">
      <div class="window-drag" /><div class="content">
        <button v-if="!globalPage && !embedded" class="text-button" @click="selected = 'Pods'">
          ‹ {{ t('Pods') }}
        </button>
        <div v-if="!['App settings', 'Pods', 'Workflows'].includes(selected)" class="page-heading">
          <h1>{{ globalPage ? (selected === 'Setup' ? t('Your accounts') : label(selected)) : creating ? t('New pod') : pod?.name ?? t('Your pods') }}</h1><span v-if="pod && !globalPage" class="muted">{{ nextRun }}</span>
        </div>
        <div v-if="attention" class="fixture-note">
          <strong role="status">{{ workerLabel }}</strong><p role="alert">
            {{ diagnostic(connectionError || status?.worker.error) }}
          </p>
        </div>
        <p v-if="dataError" role="alert" class="error-message">
          {{ diagnostic(dataError) }}
        </p>
        <nav v-if="!globalPage && !creating" class="tabs" role="tablist" :aria-label="t('Pod sections')">
          <button v-for="(tab, index) in tabs" :id="`tab-${tab}`" ref="tabButtons" :key="tab" role="tab" :aria-selected="activeTab === tab" :aria-controls="`panel-${tab}`" :tabindex="activeTab === tab ? 0 : -1" @click="selectTab(tab)" @keydown="moveTab($event, index)">
            {{ tab === 'Values' ? t('Variables and secrets') : label(tab) }}
          </button>
        </nav>
        <RunApproval v-if="!globalPage && selected !== 'History' && podId" :pod-id="podId" :approvals="approvals" />
        <AppSettings v-if="selected === 'App settings'" />
        <PodInventory v-else-if="selected === 'Pods'" :pods="pods" :workflows="workflows" :organization="organization" :available="status?.worker.state === 'ready' && !attention" @updated="workspaceChanged" @select="selectPod" @create="createPod" />
        <template v-else-if="selected === 'Workflows'">
          <GraphPanel :view="workflows" :pods="pods" :organization="organization" :selected-id="workflowId" @changed="workflows = $event" @workspace="workspaceChanged" @select="workflowId = $event" @open-pod="selectPod" />
        </template>
        <DataManagement v-else-if="selected === 'Data'" />
        <Onboarding v-else-if="selected === 'Setup'" @finished="selected = 'Overview'" />
        <section v-else-if="selected === 'Script'" id="panel-Script" role="tabpanel" aria-labelledby="tab-Script">
          <PodScript v-if="pod" :key="podId" :pod="pod" @changed="refresh" @values="openValues" @ran="selected = 'History'; refresh()" />
        </section>
        <section v-else-if="selected === 'Values'" id="panel-Values" role="tabpanel" aria-labelledby="tab-Values">
          <PodValues v-if="pod" :key="podId" :pod-id="podId" :requested-secret="requestedSecret" />
        </section>
        <section v-else-if="selected === 'Settings'" id="panel-Settings" role="tabpanel" aria-labelledby="tab-Settings">
          <PodSettings :key="podId" :selected-pod-id="podId" @selected="changed" @accounts="navigate('App settings')" />
        </section>
        <section v-else-if="selected === 'Permissions'" id="panel-Permissions" role="tabpanel" aria-labelledby="tab-Permissions">
          <PodResources :key="podId" :selected-pod-id="podId" @discuss="navigate('App settings')" />
        </section>
        <section v-else-if="selected === 'History'" id="panel-History" role="tabpanel" aria-labelledby="tab-History">
          <PodRuns :key="`${podId}:${requestedRun}`" :selected-run-id="requestedRun" :selected-pod-id="podId" @navigate="navigate($event === 'identity' ? 'Settings' : $event === 'settings' ? 'App settings' : 'Permissions')" />
        </section>
        <section v-else-if="selected === 'Knowledge'" id="panel-Overview" role="tabpanel" aria-labelledby="tab-Overview">
          <button class="text-button" @click="selected = 'Overview'">
            {{ t('Back to overview') }}
          </button><PodKnowledge v-if="pod" :key="podId" :pod-id="podId" @discuss="navigate('App settings')" />
        </section>
        <section v-else id="panel-Overview" role="tabpanel" aria-labelledby="tab-Overview">
          <template v-if="pod">
            <PodDescription :key="pod.id" :pod-id="pod.id" />
            <article v-if="workflows.contracts?.[pod.id]" class="card pod-contract">
              <div class="card-heading">
                <h2>{{ t('Contract') }}</h2><span class="badge">{{ workflows.contracts[pod.id]!.summary }}</span>
              </div>
              <p><strong>{{ t('Takes') }}</strong> {{ workflows.contracts[pod.id]!.takes.join(', ') || t('Nothing, starts with the graph') }}</p>
              <p><strong>{{ t('Gives') }}</strong> {{ workflows.contracts[pod.id]!.gives.join(', ') || t('Nothing') }}</p>
            </article>
            <article class="card">
              <div class="card-heading">
                <h2>{{ t('Last run') }}</h2><span class="badge">{{ label(runs[0]?.state ?? 'Not run yet') }}</span>
              </div><p>{{ runs[0] ? diagnostic(runHeadline(runs[0])) : t('Ready for its first manual run.') }}</p><p v-if="runs[0]" class="muted">
                {{ dateTime(runs[0].startedAt) }}
              </p><p v-if="runs[0]?.error && !schedule?.retry" class="error-message">
                {{ diagnostic(runFailure(runs[0].error)?.help) }}
              </p><div class="overview-actions">
                <button class="text-button" @click="selected = 'History'">
                  {{ t('View run trace') }}
                </button><button v-if="!access.remote" class="text-button" @click="selected = 'Knowledge'">
                  {{ t('Results and sources') }}
                </button>
              </div>
            </article>
            <div class="overview-actions">
              <button v-if="needsRecovery && !currentRun" class="primary" @click="selected = 'History'">
                {{ t('Prepare retry') }}
              </button>
              <button v-else class="primary" :disabled="!pod.activeScript || !!currentRun || !!schedule?.retry || pod.lifecycle === 'archived' || attention" @click="runOnce">
                {{ t('Run now') }}
              </button><span v-if="!pod.activeScript" class="muted">{{ t('Prepare the script before its first run.') }}</span><span v-else-if="currentRun" class="muted">{{ t('A run is active') }}</span>
            </div>
            <p v-if="schedule?.retry" role="status">
              {{ t('Waiting for service recovery. Next attempt: {time}', { time: dateTime(schedule.retry.at) }) }}
            </p>
            <p v-if="schedule?.blocked" class="error-message">
              {{ t('Unfinished work is waiting. Open run history to prepare a retry.') }}
            </p>
          </template><article v-else class="card empty-panel">
            <h2>{{ t('No pods yet') }}</h2><button class="primary" @click="createPod()">
              {{ t('Create your first pod') }}
            </button>
          </article>
        </section>
      </div>
    </div>
  </WorkspaceFrame>
</template>
