<script lang="ts">
import { t, diagnostic, label, dateTime } from './i18n'
import { defineComponent } from 'vue'
import LanguageSwitcher from './LanguageSwitcher.vue'
import PodNavigation from './PodNavigation.vue'
import type { Organization } from '../contracts/groups'
import DataManagement from './DataManagement.vue'
import Onboarding from './Onboarding.vue'
import MasterChat from './MasterChat.vue'
import PodScript from './PodScript.vue'
import PodSettings from './PodSettings.vue'
import PodResources from './PodResources.vue'
import PodRuns from './PodRuns.vue'
import PodKnowledge from './PodKnowledge.vue'
import type { StoredPod, WorkspaceState } from '../contracts/control'
import type { PodDetails } from '../contracts/details'
import type { RunRecord } from '../contracts/runs'
import type { ScheduleView } from '../contracts/scheduling'
import type { PodStatus } from '../contracts/ipc'

export default defineComponent({
  components: { LanguageSwitcher, PodNavigation, DataManagement, Onboarding, MasterChat, PodScript, PodSettings, PodResources, PodRuns, PodKnowledge },
  data() {
    return { organization: { revision: 1, groups: [] } as Organization, selected: 'Overview', tabs: ['Overview', 'Chat', 'Script', 'Permissions', 'Settings', 'History'], descriptionExpanded: false, valuesOpen: false, sidebarWidth: 224, sidebarCollapsed: false, resizeStart: 0, resizeWidth: 224, resizing: false, pods: [] as StoredPod[], podId: '', creating: false, details: null as PodDetails | null, runs: [] as RunRecord[], schedule: null as ScheduleView | null, resourceCount: 0, status: null as PodStatus | null, connectionError: '', dataError: '', busy: false, setupChecked: false, closed: false, timer: null as ReturnType<typeof setTimeout> | null, unsubscribe: null as (() => void) | null }
  },
  computed: {
    activeTab(): string { return this.selected === 'Knowledge' ? 'Overview' : this.selected },
    globalPage(): boolean { return ['App settings', 'Setup', 'Data', 'Workspace chat'].includes(this.selected) },
    pod(): StoredPod | undefined { return this.pods.find(pod => pod.id === this.podId) },
    workerLabel(): string { if (this.connectionError) return t('Unavailable'); return label({ starting: 'Starting', ready: 'Ready', error: 'Needs attention', stopped: 'Stopped' }[this.status?.worker.state ?? 'starting']) },
    attention(): boolean { return !!this.connectionError || this.status?.worker.state === 'error' },
    currentRun(): RunRecord | undefined { return this.runs.find(run => run.state === 'running') },
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
    t, diagnostic, label, dateTime,
    async openValues() { this.valuesOpen = true; this.selected = 'Settings'; await this.$nextTick(); document.getElementById('pod-values')?.scrollIntoView({ block: 'start' }) },
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
        this.workspaceChanged(await window.pods.workspace({ type: 'list' }))
        if (!this.pods.some(pod => pod.id === this.podId)) this.podId = this.creating ? '' : this.pods[0]?.id ?? ''
        const id = this.podId
        if (!id) { this.details = null; this.runs = []; this.schedule = null; this.resourceCount = 0; return }
        const [details, runs, schedule, resources] = await Promise.all([window.pods.details({ type: 'list', podId: id }), window.pods.runs({ type: 'list', podId: id }), window.pods.scheduling({ type: 'list', podId: id }), window.pods.resources({ type: 'list', podId: id })])
        if (this.podId !== id) return
        this.details = details; this.runs = runs.runs; this.schedule = schedule; this.resourceCount = resources.resources.filter(resource => resource.state === 'ready').length; this.dataError = ''
      }
      catch (error) { this.dataError = error instanceof Error ? error.message : 'Could not load workspace' }
      finally { this.busy = false }
    },
    async selectPod(id: string) { this.podId = id; this.creating = false; this.details = null; this.runs = []; this.schedule = null; this.selected = 'Overview'; await this.refresh() },
    async changed(id: string) { this.podId = id; this.creating = !id; await this.refresh() },
    async selectTab(tab: string) { await this.refresh(); this.selected = tab },
    master(create = false) { this.creating = create; if (create) this.podId = ''; this.selected = 'Chat' },
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
      <button class="new-pod" @click="master(true)">
        {{ t('＋ New pod') }}
      </button>
      <div class="sidebar-bottom">
        <button class="nav-button" :class="{ active: globalPage }" :aria-label="t('App settings')" @click="selected = 'App settings'">
          ⚙ <span>{{ t('App settings') }}</span>
        </button>
      </div>
    </aside>
    <div v-if="!sidebarCollapsed" class="sidebar-resizer" role="separator" :aria-label="t('Sidebar width')" aria-orientation="vertical" aria-valuemin="176" aria-valuemax="360" :aria-valuenow="sidebarWidth" tabindex="0" @pointerdown="beginResize" @pointermove="resize" @pointerup="persistWidth" @pointercancel="persistWidth" @keydown="resizeKey" />
    <main class="main">
      <div class="window-drag" /><div class="content">
        <div class="page-heading">
          <h1>{{ globalPage ? label(selected) : creating ? t('New pod') : pod?.name ?? t('Your pods') }}</h1><span v-if="pod && !globalPage" class="muted">{{ nextRun }}</span>
        </div>
        <div v-if="attention" class="fixture-note">
          <strong role="status">{{ workerLabel }}</strong><p role="alert">
            {{ diagnostic(connectionError || status?.worker.error) }}
          </p>
        </div>
        <p v-if="dataError" role="alert" class="error-message">
          {{ diagnostic(dataError) }}
        </p>
        <nav v-if="!globalPage" class="tabs" role="tablist" :aria-label="t('Pod sections')">
          <button v-for="(tab, index) in tabs" :id="`tab-${tab}`" ref="tabButtons" :key="tab" role="tab" :aria-selected="activeTab === tab" :aria-controls="`panel-${tab}`" :tabindex="activeTab === tab ? 0 : -1" @click="selectTab(tab)" @keydown="moveTab($event, index)">
            {{ label(tab) }}
          </button>
        </nav>
        <section v-if="selected === 'App settings'" class="card">
          <h2>{{ t('App settings') }}</h2><LanguageSwitcher /><div class="overview-actions">
            <button class="secondary" @click="selected = 'Setup'">
              {{ t('Connections & setup') }}
            </button><button class="secondary" @click="selected = 'Data'">
              {{ t('Data & backups') }}
            </button><button class="secondary" @click="selected = 'Workspace chat'">
              {{ t('Workspace chat') }}
            </button>
          </div>
        </section>
        <DataManagement v-else-if="selected === 'Data'" />
        <Onboarding v-else-if="selected === 'Setup'" :pod="pod" @finished="selected = 'Overview'" @reference="selected = 'Permissions'" />
        <section v-else-if="selected === 'Chat' || selected === 'Workspace chat'" id="panel-Chat" :role="globalPage ? undefined : 'tabpanel'" :aria-labelledby="globalPage ? undefined : 'tab-Chat'" :aria-label="globalPage ? t('Workspace chat') : undefined" class="card master-panel">
          <MasterChat :key="creating || selected === 'Workspace chat' ? 'workspace' : podId" :pod-id="creating || selected === 'Workspace chat' ? null : podId || null" @resources="async id => { await selectPod(id); selected = 'Permissions' }" @settings="async id => { await selectPod(id); await openValues() }" /><details v-if="creating">
            <summary>{{ t('Create without chat') }}</summary><PodSettings key="new" @selected="changed" />
          </details>
        </section>
        <section v-else-if="selected === 'Script'" id="panel-Script" role="tabpanel" aria-labelledby="tab-Script">
          <PodScript v-if="pod" :key="podId" :pod="pod" @changed="refresh" @values="openValues" @ran="selected = 'History'; refresh()" />
        </section>
        <section v-else-if="selected === 'Settings'" id="panel-Settings" role="tabpanel" aria-labelledby="tab-Settings">
          <PodSettings :key="podId" :selected-pod-id="podId" :show-values="valuesOpen" @selected="changed" />
        </section>
        <section v-else-if="selected === 'Permissions'" id="panel-Permissions" role="tabpanel" aria-labelledby="tab-Permissions">
          <PodResources :key="podId" :selected-pod-id="podId" @discuss="master()" />
        </section>
        <section v-else-if="selected === 'History'" id="panel-History" role="tabpanel" aria-labelledby="tab-History">
          <PodRuns :key="podId" :selected-pod-id="podId" />
        </section>
        <section v-else-if="selected === 'Knowledge'" id="panel-Overview" role="tabpanel" aria-labelledby="tab-Overview">
          <button class="text-button" @click="selected = 'Overview'">
            {{ t('Back to overview') }}
          </button><PodKnowledge v-if="pod" :key="podId" :pod-id="podId" @discuss="master()" />
        </section>
        <section v-else id="panel-Overview" role="tabpanel" aria-labelledby="tab-Overview">
          <template v-if="pod">
            <article class="card">
              <h2>{{ t('Description') }}</h2><p class="assignment-text">
                {{ pod.assignment }}
              </p><details @toggle="descriptionExpanded = ($event.target as HTMLDetailsElement).open">
                <summary>{{ t('Edit description') }}</summary><PodSettings v-if="descriptionExpanded" :selected-pod-id="podId" description-only @selected="changed" />
              </details>
            </article>
            <article class="card">
              <div class="card-heading">
                <h2>{{ t('Last run') }}</h2><span class="badge">{{ label(runs[0]?.state ?? 'Not run yet') }}</span>
              </div><p>{{ runs[0]?.summary || t('Ready for its first manual run.') }}</p><p v-if="runs[0]" class="muted">
                {{ dateTime(runs[0].startedAt) }}
              </p><p v-if="runs[0]?.error" class="error-message">
                {{ diagnostic(runs[0].error) }}
              </p><div class="overview-actions">
                <button class="text-button" @click="selected = 'History'">
                  {{ t('View run trace') }}
                </button><button class="text-button" @click="selected = 'Knowledge'">
                  {{ t('Results and sources') }}
                </button>
              </div>
            </article>
            <div class="overview-actions">
              <button class="primary" :disabled="!pod.activeScript || !!currentRun || pod.lifecycle === 'archived' || attention" @click="runOnce">
                {{ t('Run now') }}
              </button><span v-if="!pod.activeScript" class="muted">{{ t('Prepare the script before its first run.') }}</span><span v-else-if="currentRun" class="muted">{{ t('A run is active') }}</span>
            </div>
            <p v-if="schedule?.blocked" class="error-message">
              {{ t('{p0} inputs awaiting recovery', { p0: schedule.blocked }) }}
            </p>
          </template><article v-else class="card empty-panel">
            <h2>{{ t('No pods yet') }}</h2><button class="primary" @click="master(true)">
              {{ t('Create your first pod') }}
            </button>
          </article>
        </section>
      </div>
    </main>
  </div>
</template>
