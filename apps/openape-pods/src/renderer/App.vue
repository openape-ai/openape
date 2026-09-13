<script lang="ts">
import { t, diagnostic, label, dateTime } from './i18n'
import { defineComponent } from 'vue'
import LanguageSwitcher from './LanguageSwitcher.vue'
import PodNavigation from './PodNavigation.vue'
import type { Organization } from '../contracts/groups'
import DataManagement from './DataManagement.vue'
import Onboarding from './Onboarding.vue'
import MasterChat from './MasterChat.vue'
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
  components: { LanguageSwitcher, PodNavigation, DataManagement, Onboarding, MasterChat, PodSettings, PodResources, PodRuns, PodKnowledge },
  data() {
    return { organization: { revision: 1, groups: [] } as Organization, selected: 'Overview', tabs: ['Overview', 'Knowledge', 'Resources', 'Runs', 'Settings'], pods: [] as StoredPod[], podId: '', creating: false, details: null as PodDetails | null, runs: [] as RunRecord[], schedule: null as ScheduleView | null, resourceCount: 0, status: null as PodStatus | null, connectionError: '', dataError: '', busy: false, setupChecked: false, closed: false, timer: null as ReturnType<typeof setTimeout> | null, unsubscribe: null as (() => void) | null }
  },
  computed: {
    pod(): StoredPod | undefined { return this.pods.find(pod => pod.id === this.podId) },
    workerLabel(): string { if (this.connectionError) return t('Unavailable'); return label({ starting: 'Starting', ready: 'Ready', error: 'Needs attention', stopped: 'Stopped' }[this.status?.worker.state ?? 'starting']) },
    attention(): boolean { return !!this.connectionError || this.status?.worker.state === 'error' },
    currentRun(): RunRecord | undefined { return this.runs.find(run => run.state === 'running') },
    nextRun(): string { if (!this.pod || this.pod.lifecycle !== 'active' || !this.schedule?.enabled) return t('Manual only'); return this.schedule.nextAt ? dateTime(this.schedule.nextAt) : t('No scheduled time') },
  },
  async mounted() {
    try { this.unsubscribe = window.pods.onStatus((status) => { this.status = status }); this.status = await window.pods.getStatus(); await this.refresh() }
    catch (error) { this.connectionError = error instanceof Error ? error.message : 'Could not reach the desktop worker' }
    this.poll()
  },
  beforeUnmount() { this.closed = true; this.unsubscribe?.(); if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, diagnostic, label, dateTime,
    workspaceChanged(state: WorkspaceState) { if (state.organization.revision < this.organization.revision) return; this.pods = state.pods; this.organization = state.organization },
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { await this.refresh(); this.poll() }, 1000) },
    async refresh() {
      if (this.busy || this.status?.worker.state !== 'ready') return
      this.busy = true
      try {
        if (!this.setupChecked && this.status?.mode === 'local') { const setup = await window.pods.onboarding({ type: 'list' }); this.setupChecked = true; if (!setup.complete) this.selected = 'Setup' }
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
    master(create = false) { this.creating = create; this.selected = 'Master chat' },
    async runOnce() {
      if (!this.pod) return; try { await window.pods.runs({ type: 'start', podId: this.pod.id }); this.selected = 'Runs'; await this.refresh() }
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
  <div class="workspace">
    <aside class="sidebar" :aria-label="t('Pod navigation')">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">{{ t("o.") }}</span><span>{{ t("OpenApe") }} <strong>{{ t("Pods") }}</strong></span>
      </div>
      <button class="nav-button" :class="{ active: selected === 'Master chat' }" @click="master()">
        <span aria-hidden="true">✦</span> {{ t("Master chat") }} <span class="nav-arrow" aria-hidden="true">↗</span>
      </button>
      <button class="nav-button" :class="{ active: selected === 'Setup' }" @click="selected = 'Setup'">
        {{ t("Connections & setup") }}
      </button>
      <button class="nav-button" :class="{ active: selected === 'Data' }" @click="selected = 'Data'">
        {{ t("Data & backups") }}
      </button>
      <PodNavigation :pods="pods" :pod-id="podId" :organization="organization" :available="status?.worker.state === 'ready' && !attention" :highlight="selected !== 'Master chat'" @select="selectPod" @updated="workspaceChanged" />
      <button class="new-pod" @click="master(true)">
        {{ t("＋ New pod") }}
      </button>
      <LanguageSwitcher />
      <div class="sidebar-bottom">
        <span class="status-dot" :class="{ warning: attention }" /><span>{{ t("Running on this Mac") }}<small>{{ t(pods.length === 1 ? '{p0} local pod' : '{p0} local pods', { p0: pods.length }) }}</small></span>
      </div>
    </aside>
    <main class="main">
      <header class="toolbar">
        <span>{{ t("Pods") }} <span class="crumb" aria-hidden="true">/</span> {{ selected === 'Master chat' ? t("Master chat") : pod?.name ?? t("Your workspace") }}</span><span class="fixture-label">{{ status?.mode === 'fixture' ? t("Fixture mode") : t("On this Mac") }}</span>
      </header>
      <div class="content">
        <div class="page-heading">
          <div>
            <p class="eyebrow">
              {{ t("YOUR WORKSPACE") }}
            </p><h1>{{ selected === 'Master chat' ? t("Master chat") : pod?.name ?? t("Your pods") }}</h1><p class="subtitle">
              {{ t("A place for context that lasts beyond a conversation.") }}
            </p>
          </div><button class="primary" :disabled="!pod || !pod.activeScript || !!currentRun || pod.lifecycle === 'archived' || attention" @click="runOnce">
            {{ t("Run once") }} <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div v-if="attention" class="fixture-note">
          <strong role="status">{{ workerLabel }}</strong><p role="alert">
            {{ diagnostic(connectionError || status?.worker.error) }}
          </p>
        </div>
        <div v-else class="fixture-note">
          <span aria-hidden="true">◌</span><p><strong>{{ pod ? t(resourceCount === 1 ? '{state} · {count} resource ready' : '{state} · {count} resources ready', { state: label(pod.lifecycle), count: resourceCount }) : t("Create your first pod.") }}</strong> {{ pod ? t("Knowledge and progress are saved on this Mac.") : t("Start with an assignment, then review resources and run manually.") }}</p><span class="badge" role="status">{{ workerLabel }}</span>
        </div>
        <p v-if="dataError" role="alert" class="error-message">
          {{ diagnostic(dataError) }}
        </p>
        <nav class="tabs" role="tablist" :aria-label="t('Pod sections')">
          <button v-for="(tab, index) in tabs" :id="`tab-${tab}`" ref="tabButtons" :key="tab" role="tab" :aria-selected="selected === tab" :aria-controls="`panel-${tab}`" :tabindex="selected === tab || (selected === 'Master chat' && index === 0) ? 0 : -1" @click="selectTab(tab)" @keydown="moveTab($event, index)">
            {{ label(tab) }}
          </button>
        </nav>
        <DataManagement v-if="selected === 'Data'" />
        <Onboarding v-else-if="selected === 'Setup'" :pod="pod" @finished="selected = 'Overview'" @assigned="refresh" @reference="selected = 'Resources'" />
        <section v-else-if="selected === 'Overview'" id="panel-Overview" role="tabpanel" aria-labelledby="tab-Overview">
          <template v-if="pod">
            <div class="overview-grid">
              <article class="card assignment">
                <div class="card-heading">
                  <h2>{{ t("What this pod is here for") }}</h2><span class="badge">{{ t("Revision {p0}", { p0: pod.revision }) }}</span>
                </div><p class="assignment-text">
                  {{ pod.assignment }}
                </p><button class="text-button" @click="selectTab('Settings')">
                  {{ t("Edit assignment") }}
                </button><div class="card-footer">
                  <span class="mini-label">{{ t("NEXT RUN") }}</span><span>{{ nextRun }}</span><span>{{ t("{p0} queued · {p1} awaiting recovery", { p0: schedule?.pending ?? 0, p1: schedule?.blocked ?? 0 }) }}</span>
                </div>
              </article>
              <article class="card">
                <div class="card-heading">
                  <h2>{{ t("Latest result") }}</h2><span class="badge">{{ label(runs[0]?.state ?? t("Not run yet")) }}</span>
                </div><p class="assignment-text">
                  {{ runs[0]?.summary || t("Ready for its first manual run.") }}
                </p><p v-if="runs[0]?.error" class="error-message">
                  {{ diagnostic(runs[0].error) }}
                </p><p class="muted">
                  {{ t("Checkpoint {p0}", { p0: details?.checkpointRevision ?? 0 }) }}
                </p><div class="overview-actions">
                  <button class="text-button" @click="selectTab('Runs')">
                    {{ t("View run trace") }}
                  </button><button class="secondary" :disabled="pod.lifecycle === 'archived'" @click="pause">
                    {{ pod.lifecycle === 'active' ? t("Pause automatic runs") : t("Resume automatic runs") }}
                  </button>
                </div>
              </article>
            </div>
            <article class="card first-run">
              <span class="empty-icon" aria-hidden="true">⌁</span><div>
                <h2>{{ details?.total ? t("Sourced knowledge") : t("No knowledge collected yet") }}</h2><p class="muted">
                  {{ t(details?.counts.finding === 1 ? '{count} finding' : '{count} findings', { count: details?.counts.finding ?? 0 }) }} · {{ t(details?.counts.question === 1 ? '{count} open question' : '{count} open questions', { count: details?.counts.question ?? 0 }) }} · {{ t(details?.counts.gap === 1 ? '{count} verification gap' : '{count} verification gaps', { count: details?.counts.gap ?? 0 }) }}
                </p>
              </div><button class="text-button" @click="selectTab('Knowledge')">
                {{ t("View knowledge →") }}
              </button>
            </article>
            <div class="next-step">
              <div>
                <p class="eyebrow">
                  {{ t("CONTEXT · {p0}", { p0: pod.name }) }}
                </p><h2>{{ t("Keep the assignment and evidence together.") }}</h2>
              </div><button class="secondary" @click="master()">
                {{ t("Open master chat ↗") }}
              </button>
            </div>
          </template>
          <article v-else class="card empty-panel">
            <span class="empty-icon" aria-hidden="true">⌁</span><h2>{{ t("No pods yet") }}</h2><p class="muted">
              {{ t("Create a pod with its own assignment, workspace and explicitly assigned resources.") }}
            </p><button class="secondary" @click="master(true)">
              {{ t("Create your first pod") }}
            </button>
          </article>
        </section>
        <section v-else-if="selected === 'Master chat'" class="card master-panel" :aria-label="t('Master chat')">
          <p class="eyebrow">
            {{ t("CONTEXT · {p0}", { p0: creating ? t("NEW POD") : pod?.name ?? t("WORKSPACE") }) }}
          </p><h2>{{ t("Master chat") }}</h2><MasterChat :pod-id="creating ? null : podId || null" @resources="async id => { await selectPod(id); selected = 'Resources' }" /><PodSettings v-if="creating" key="new" @selected="changed" />
        </section>
        <section v-else-if="selected === 'Settings'" id="panel-Settings" role="tabpanel" aria-labelledby="tab-Settings">
          <PodSettings :selected-pod-id="podId" @selected="changed" />
        </section>
        <section v-else-if="selected === 'Resources'" id="panel-Resources" role="tabpanel" aria-labelledby="tab-Resources">
          <button class="secondary" @click="selected = 'Setup'">
            {{ t("Manage accounts and mail scope") }}
          </button>
          <PodResources :key="podId" :selected-pod-id="podId" @discuss="master()" />
        </section>
        <section v-else-if="selected === 'Runs'" id="panel-Runs" role="tabpanel" aria-labelledby="tab-Runs">
          <PodRuns :key="podId" :selected-pod-id="podId" />
        </section>
        <section v-else id="panel-Knowledge" role="tabpanel" aria-labelledby="tab-Knowledge">
          <PodKnowledge v-if="pod" :key="podId" :pod-id="podId" @discuss="master()" /><article v-else class="card empty-panel">
            <h2>{{ t("Supported findings") }}</h2><p class="muted">
              {{ t("Create a pod to collect knowledge with sources.") }}
            </p>
          </article>
        </section>
      </div>
      <footer class="footer">
        <span><span class="status-dot" :class="{ warning: attention }" /> {{ t("Worker {p0}", { p0: workerLabel.toLowerCase() }) }}</span><span>{{ t(pods.length === 1 ? '{p0} · {p1} pod' : '{p0} · {p1} pods', { p0: currentRun ? t("A run is active") : t("Local workspace"), p1: pods.length }) }}</span>
      </footer>
    </main>
  </div>
</template>
