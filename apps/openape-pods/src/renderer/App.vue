<script lang="ts">
import { t, diagnostic, label, dateTime } from './i18n'
import { defineComponent } from 'vue'
import WorkflowPanel from './WorkflowPanel.vue'
import type { WorkflowView } from '../contracts/workflows'
import LanguageSwitcher from './LanguageSwitcher.vue'
import CodexPanel from './CodexPanel.vue'
import JevConnection from './JevConnection.vue'
import PodNavigation from './PodNavigation.vue'
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
  components: { JevConnection, CodexPanel, WorkflowPanel, AccountStatus, RunApproval, PodDescription, LanguageSwitcher, PodNavigation, DataManagement, Onboarding, PodScript, PodSettings, PodValues, PodResources, PodRuns, PodKnowledge },
  data() {
    return { requestedRun: '', workflowId: '', workflows: { workflows: [], runs: [] } as WorkflowView, requestedSecret: '', approvals: [] as (Approval & { runId: string })[], organization: { revision: 1, groups: [] } as Organization, selected: 'Overview', tabs: ['Overview', 'Script', 'Values', 'Permissions', 'Settings', 'History'], descriptionExpanded: false, sidebarWidth: 224, sidebarCollapsed: false, resizeStart: 0, resizeWidth: 224, resizing: false, pods: [] as StoredPod[], podId: '', creating: false, details: null as PodDetails | null, runs: [] as RunRecord[], schedule: null as ScheduleView | null, resourceCount: 0, status: null as PodStatus | null, connectionError: '', dataError: '', busy: false, setupChecked: false, closed: false, timer: null as ReturnType<typeof setTimeout> | null, unsubscribe: null as (() => void) | null }
  },
  computed: {
    activeTab(): string { return this.selected === 'Knowledge' ? 'Overview' : this.selected },
    globalPage(): boolean { return ['App settings', 'Setup', 'Data', 'Workflows'].includes(this.selected) },
    pod(): StoredPod | undefined { return this.pods.find(pod => pod.id === this.podId) },
    workerLabel(): string { if (this.connectionError) return t('Unavailable'); return label({ starting: 'Starting', ready: 'Ready', error: 'Needs attention', stopped: 'Stopped' }[this.status?.worker.state ?? 'starting']) },
    attention(): boolean { return !!this.connectionError || this.status?.worker.state === 'error' },
    currentRun(): RunRecord | undefined { return this.runs.find(run => run.state === 'running') },
    needsRecovery(): boolean { const run = this.runs[0]; return !!run && ['interrupted', 'failed', 'cancelled', 'blocked'].includes(run.state) && run.recovery?.state !== 'retryQueued' },
    nextRun(): string { if (!this.pod || this.pod.lifecycle !== 'active' || !this.schedule?.enabled) return t('Manual only'); return this.schedule.nextAt ? dateTime(this.schedule.nextAt) : t('No scheduled time') },
  },
  async mounted() {
    try { const width = Number(localStorage.getItem('pods-sidebar-width')); if (width >= 176 && width <= 360) this.sidebarWidth = width }
    catch (error) { this.dataError = String(error) }
    try { this.unsubscribe = window.pods.onStatus((status) => { this.status = status }); this.status = await window.pods.getStatus(); await this.refresh() }
    catch (error) { this.connectionError = error instanceof Error ? error.message : 'Could not reach the desktop worker' }
    this.poll()
  },
  beforeUnmount() { this.closed = true; this.unsubscribe?.(); if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, runFailure, runHeadline, diagnostic, label, dateTime,
    async openRun(podId: string, runId: string) { await this.selectPod(podId); this.requestedRun = runId; this.selected = 'History' },
    openValues(alias = '') { this.requestedSecret = alias; this.selected = 'Values' },
    beginResize(event: PointerEvent) { this.resizing = true; this.resizeStart = event.clientX; this.resizeWidth = this.sidebarWidth; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) },
    resize(event: PointerEvent) { if (this.resizing) this.sidebarWidth = Math.max(176, Math.min(360, window.innerWidth - 340, this.resizeWidth + event.clientX - this.resizeStart)) },
    persistWidth() {
      this.resizing = false; try { localStorage.setItem('pods-sidebar-width', String(this.sidebarWidth)) }
      catch (error) { this.dataError = String(error) }
    },
    resizeKey(event: KeyboardEvent) { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); this.sidebarWidth = Math.max(176, Math.min(360, window.innerWidth - 340, this.sidebarWidth + (event.key === 'ArrowRight' ? 16 : -16))); this.persistWidth() },
    workspaceChanged(state: WorkspaceState) { if (state.organization.revision < this.organization.revision) return; this.pods = state.pods; this.organization = state.organization },
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { await this.refresh(); this.poll() }, 1000) },
    async refresh() {
      if (this.busy || this.status?.worker.state !== 'ready') return
      this.busy = true
      try {
        const [workspace, workflows] = await Promise.all([window.pods.workspace({ type: 'list' }), window.pods.workflows({ type: 'list' })])
        this.workspaceChanged(workspace); this.workflows = workflows
        if (!this.pods.some(pod => pod.id === this.podId)) this.podId = this.creating ? '' : this.pods[0]?.id ?? ''
        const id = this.podId
        if (!id) { this.details = null; this.runs = []; this.schedule = null; this.resourceCount = 0; return }
        const [details, runs, schedule, resources] = await Promise.all([window.pods.details({ type: 'list', podId: id }), window.pods.runs({ type: 'list', podId: id }), window.pods.scheduling({ type: 'list', podId: id }), window.pods.resources({ type: 'list', podId: id })])
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
      if (!this.pod) return; try { await window.pods.runs({ type: 'start', podId: this.pod.id, expectedScript: this.pod.activeScript ?? undefined }); this.selected = 'History'; await this.refresh() }
      catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not start run' }
    },
    async pause() {
      if (!this.pod) return
      try { await window.pods.scheduling({ type: 'lifecycle', podId: this.pod.id, revision: this.pod.revision, lifecycle: this.pod.lifecycle === 'active' ? 'paused' : 'active' }); await this.refresh() }
      catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not change lifecycle' }
    },
    moveTab(event: KeyboardEvent, index: number) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length
      this.selected = this.tabs[next]; (this.$refs.tabButtons as HTMLButtonElement[])[next].focus()
    },
  },
})
</script>

<template>
  <div class="workspace" :class="{ 'sidebar-collapsed': sidebarCollapsed }" :style="{ '--sidebar-width': `${sidebarWidth}px` }">
    <aside class="sidebar" :aria-label="t('Pod navigation')">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">{{ 'o.' }}</span><span class="brand-title">{{ 'OpenApe' }} <strong>{{ 'Pods' }}</strong></span>
      </div>
      <button class="collapse-sidebar" :aria-label="t(sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar')" @click="sidebarCollapsed = !sidebarCollapsed">
        {{ sidebarCollapsed ? '⇥' : '⇤' }}
      </button>
      <PodNavigation hide-group-picker :pods="pods" :pod-id="podId" :organization="organization" :available="status?.worker.state === 'ready' && !attention" :highlight="!globalPage" @select="selectPod" @updated="workspaceChanged" />
      <button class="new-pod" @click="createPod()">
        {{ t('＋ New pod') }}
      </button>
      <nav class="workflow-navigation" :aria-label="t('Workflows')">
        <button class="nav-button" :class="{ active: selected === 'Workflows' && !workflowId }" @click="selected = 'Workflows'; workflowId = ''">
          {{ t('Workflows') }}
        </button>
        <button v-for="workflow in workflows.workflows" :key="workflow.id" class="pod-button" :class="{ active: selected === 'Workflows' && workflowId === workflow.id }" @click="selected = 'Workflows'; workflowId = workflow.id">
          {{ workflow.name }}
        </button>
      </nav>
      <div class="sidebar-bottom">
        <AccountStatus :available="status?.worker.state === 'ready'" @open="selected = 'Setup'" />
        <button class="nav-button" :class="{ active: globalPage && selected !== 'Workflows' }" :aria-label="t('App settings')" @click="selected = 'App settings'">
          ⚙ <span>{{ t('App settings') }}</span>
        </button>
      </div>
    </aside>
    <div v-if="!sidebarCollapsed" class="sidebar-resizer" role="separator" :aria-label="t('Sidebar width')" aria-orientation="vertical" aria-valuemin="176" aria-valuemax="360" :aria-valuenow="sidebarWidth" tabindex="0" @pointerdown="beginResize" @pointermove="resize" @pointerup="persistWidth" @pointercancel="persistWidth" @keydown="resizeKey" />
    <main class="main">
      <div class="window-drag" /><div class="content">
        <div class="page-heading">
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
        <section v-if="selected === 'App settings'" class="card">
          <h2>{{ t('App settings') }}</h2><LanguageSwitcher /><CodexPanel /><JevConnection /><div class="overview-actions">
            <button class="secondary" @click="selected = 'Setup'">
              {{ t('Your accounts') }}
            </button><button class="secondary" @click="selected = 'Data'">
              {{ t('Data & backups') }}
            </button>
          </div>
        </section>
        <template v-else-if="selected === 'Workflows'">
          <WorkflowPanel :view="workflows" :pods="pods" :selected-id="workflowId" @changed="workflows = $event" @select="workflowId = $event" />
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
          <PodSettings :key="podId" :selected-pod-id="podId" @selected="changed" @accounts="selected = 'Setup'" />
        </section>
        <section v-else-if="selected === 'Permissions'" id="panel-Permissions" role="tabpanel" aria-labelledby="tab-Permissions">
          <PodResources :key="podId" :selected-pod-id="podId" @discuss="selected = 'App settings'" />
        </section>
        <section v-else-if="selected === 'History'" id="panel-History" role="tabpanel" aria-labelledby="tab-History">
          <PodRuns :key="`${podId}:${requestedRun}`" :selected-run-id="requestedRun" :selected-pod-id="podId" @navigate="selected = $event === 'identity' ? 'Settings' : $event === 'settings' ? 'App settings' : 'Permissions'" />
        </section>
        <section v-else-if="selected === 'Knowledge'" id="panel-Overview" role="tabpanel" aria-labelledby="tab-Overview">
          <button class="text-button" @click="selected = 'Overview'">
            {{ t('Back to overview') }}
          </button><PodKnowledge v-if="pod" :key="podId" :pod-id="podId" @discuss="selected = 'App settings'" />
        </section>
        <section v-else id="panel-Overview" role="tabpanel" aria-labelledby="tab-Overview">
          <template v-if="pod">
            <PodDescription :key="pod.id" :pod-id="pod.id" />
            <article class="card">
              <div class="card-heading">
                <h2>{{ t('Last run') }}</h2><span class="badge">{{ label(runs[0]?.state ?? 'Not run yet') }}</span>
              </div><p>{{ runs[0] ? diagnostic(runHeadline(runs[0])) : t('Ready for its first manual run.') }}</p><p v-if="runs[0]" class="muted">
                {{ dateTime(runs[0].startedAt) }}
              </p><p v-if="runs[0]?.error" class="error-message">
                {{ diagnostic(runFailure(runs[0].error)?.help) }}
              </p><div class="overview-actions">
                <button class="text-button" @click="selected = 'History'">
                  {{ t('View run trace') }}
                </button><button class="text-button" @click="selected = 'Knowledge'">
                  {{ t('Results and sources') }}
                </button>
              </div>
            </article>
            <div class="overview-actions">
              <button v-if="needsRecovery && !currentRun" class="primary" @click="selected = 'History'">
                {{ t('Prepare retry') }}
              </button>
              <button v-else class="primary" :disabled="!pod.activeScript || !!currentRun || pod.lifecycle === 'archived' || attention" @click="runOnce">
                {{ t('Run now') }}
              </button><span v-if="!pod.activeScript" class="muted">{{ t('Prepare the script before its first run.') }}</span><span v-else-if="currentRun" class="muted">{{ t('A run is active') }}</span>
            </div>
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
    </main>
  </div>
</template>
