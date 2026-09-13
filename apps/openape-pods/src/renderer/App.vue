<script lang="ts">
import { defineComponent } from 'vue'
import PodSettings from './PodSettings.vue'
import PodResources from './PodResources.vue'
import PodRuns from './PodRuns.vue'
import PodKnowledge from './PodKnowledge.vue'
import type { StoredPod } from '../contracts/control'
import type { PodDetails } from '../contracts/details'
import type { RunRecord } from '../contracts/runs'
import type { ScheduleView } from '../contracts/scheduling'
import type { PodStatus } from '../contracts/ipc'

export default defineComponent({
  components: { PodSettings, PodResources, PodRuns, PodKnowledge },
  data() {
    return { selected: 'Overview', tabs: ['Overview', 'Knowledge', 'Resources', 'Runs', 'Settings'], pods: [] as StoredPod[], podId: '', creating: false, details: null as PodDetails | null, runs: [] as RunRecord[], schedule: null as ScheduleView | null, resourceCount: 0, status: null as PodStatus | null, connectionError: '', dataError: '', busy: false, closed: false, timer: null as ReturnType<typeof setTimeout> | null, unsubscribe: null as (() => void) | null }
  },
  computed: {
    pod(): StoredPod | undefined { return this.pods.find(pod => pod.id === this.podId) },
    workerLabel(): string { if (this.connectionError) return 'Unavailable'; return { starting: 'Starting', ready: 'Ready', error: 'Needs attention', stopped: 'Stopped' }[this.status?.worker.state ?? 'starting'] },
    attention(): boolean { return !!this.connectionError || this.status?.worker.state === 'error' },
    currentRun(): RunRecord | undefined { return this.runs.find(run => run.state === 'running') },
    nextRun(): string { if (!this.pod || this.pod.lifecycle !== 'active' || !this.schedule?.enabled) return 'Manual only'; return this.schedule.nextAt ? new Date(this.schedule.nextAt).toLocaleString() : 'No scheduled time' },
  },
  async mounted() {
    try { this.unsubscribe = window.pods.onStatus((status) => { this.status = status }); this.status = await window.pods.getStatus(); await this.refresh() }
    catch (error) { this.connectionError = error instanceof Error ? error.message : 'Could not reach the desktop worker' }
    this.poll()
  },
  beforeUnmount() { this.closed = true; this.unsubscribe?.(); if (this.timer) clearTimeout(this.timer) },
  methods: {
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { await this.refresh(); this.poll() }, 1000) },
    async refresh() {
      if (this.busy || this.status?.worker.state !== 'ready') return
      this.busy = true
      try {
        this.pods = (await window.pods.workspace({ type: 'list' })).pods
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
    <aside class="sidebar" aria-label="Pod navigation">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">o.</span><span>OpenApe <strong>Pods</strong></span>
      </div>
      <button class="nav-button" :class="{ active: selected === 'Master chat' }" @click="master()">
        <span aria-hidden="true">✦</span> Master chat <span class="nav-arrow" aria-hidden="true">↗</span>
      </button>
      <div class="sidebar-label">
        YOUR PODS <span>{{ pods.length }}</span>
      </div>
      <div class="pod-list">
        <button v-for="item in pods" :key="item.id" class="pod-button" :class="{ active: item.id === podId && selected !== 'Master chat' }" :aria-pressed="item.id === podId" @click="selectPod(item.id)">
          <span class="pod-icon" aria-hidden="true">↗</span><span>{{ item.name }}<small>{{ item.lifecycle }}</small></span>
        </button><p v-if="!pods.length" class="muted">
          No pods yet
        </p>
      </div>
      <button class="new-pod" @click="master(true)">
        ＋ New pod
      </button>
      <div class="sidebar-bottom">
        <span class="status-dot" :class="{ warning: attention }" /><span>Running on this Mac<small>{{ pods.length }} local pods</small></span>
      </div>
    </aside>
    <main class="main">
      <header class="toolbar">
        <span>Pods <span class="crumb" aria-hidden="true">/</span> {{ selected === 'Master chat' ? 'Master chat' : pod?.name ?? 'Your workspace' }}</span><span class="fixture-label">Fixture mode</span>
      </header>
      <div class="content">
        <div class="page-heading">
          <div>
            <p class="eyebrow">
              YOUR WORKSPACE
            </p><h1>{{ selected === 'Master chat' ? 'Master chat' : pod?.name ?? 'Your pods' }}</h1><p class="subtitle">
              A place for context that lasts beyond a conversation.
            </p>
          </div><button class="primary" :disabled="!pod || !pod.activeScript || !!currentRun || pod.lifecycle === 'archived' || attention" @click="runOnce">
            Run once <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div v-if="attention" class="fixture-note">
          <strong role="status">{{ workerLabel }}</strong><p role="alert">
            {{ connectionError || status?.worker.error }}
          </p>
        </div>
        <div v-else class="fixture-note">
          <span aria-hidden="true">◌</span><p><strong>{{ pod ? `${pod.lifecycle} · ${resourceCount} resource${resourceCount === 1 ? '' : 's'} ready` : 'Create your first pod.' }}</strong> {{ pod ? 'Knowledge and progress are saved on this Mac.' : 'Start with an assignment, then review resources and run manually.' }}</p><span class="badge" role="status">{{ workerLabel }}</span>
        </div>
        <p v-if="dataError" role="alert" class="error-message">
          {{ dataError }}
        </p>
        <nav class="tabs" role="tablist" aria-label="Pod sections">
          <button v-for="(tab, index) in tabs" :id="`tab-${tab}`" ref="tabButtons" :key="tab" role="tab" :aria-selected="selected === tab" :aria-controls="`panel-${tab}`" :tabindex="selected === tab || (selected === 'Master chat' && index === 0) ? 0 : -1" @click="selectTab(tab)" @keydown="moveTab($event, index)">
            {{ tab }}
          </button>
        </nav>
        <section v-if="selected === 'Overview'" id="panel-Overview" role="tabpanel" aria-labelledby="tab-Overview">
          <template v-if="pod">
            <div class="overview-grid">
              <article class="card assignment">
                <div class="card-heading">
                  <h2>What this pod is here for</h2><span class="badge">Revision {{ pod.revision }}</span>
                </div><p class="assignment-text">
                  {{ pod.assignment }}
                </p><button class="text-button" @click="selectTab('Settings')">
                  Edit assignment
                </button><div class="card-footer">
                  <span class="mini-label">NEXT RUN</span><span>{{ nextRun }}</span><span>{{ schedule?.pending ?? 0 }} queued · {{ schedule?.blocked ?? 0 }} awaiting recovery</span>
                </div>
              </article>
              <article class="card">
                <div class="card-heading">
                  <h2>Latest result</h2><span class="badge">{{ runs[0]?.state ?? 'Not run yet' }}</span>
                </div><p class="assignment-text">
                  {{ runs[0]?.summary || 'Ready for its first manual run.' }}
                </p><p v-if="runs[0]?.error" class="error-message">
                  {{ runs[0].error }}
                </p><p class="muted">
                  Checkpoint {{ details?.checkpointRevision ?? 0 }}
                </p><div class="overview-actions">
                  <button class="text-button" @click="selectTab('Runs')">
                    View run trace
                  </button><button class="secondary" :disabled="pod.lifecycle === 'archived'" @click="pause">
                    {{ pod.lifecycle === 'active' ? 'Pause automatic runs' : 'Resume automatic runs' }}
                  </button>
                </div>
              </article>
            </div>
            <article class="card first-run">
              <span class="empty-icon" aria-hidden="true">⌁</span><div>
                <h2>{{ details?.total ? 'Sourced knowledge' : 'No knowledge collected yet' }}</h2><p class="muted">
                  {{ details?.counts.finding ?? 0 }} findings · {{ details?.counts.question ?? 0 }} open questions · {{ details?.counts.gap ?? 0 }} verification gaps
                </p>
              </div><button class="text-button" @click="selectTab('Knowledge')">
                View knowledge →
              </button>
            </article>
            <div class="next-step">
              <div>
                <p class="eyebrow">
                  CONTEXT · {{ pod.name }}
                </p><h2>Keep the assignment and evidence together.</h2>
              </div><button class="secondary" @click="master()">
                Open master chat ↗
              </button>
            </div>
          </template>
          <article v-else class="card empty-panel">
            <span class="empty-icon" aria-hidden="true">⌁</span><h2>No pods yet</h2><p class="muted">
              Create a pod with its own assignment, workspace and explicitly assigned resources.
            </p><button class="secondary" @click="master(true)">
              Create your first pod
            </button>
          </article>
        </section>
        <section v-else-if="selected === 'Master chat'" class="card master-panel" aria-label="Master chat">
          <p class="eyebrow">
            CONTEXT · {{ creating ? 'NEW POD' : pod?.name ?? 'WORKSPACE' }}
          </p><h2>Master chat</h2><p class="muted">
            Chat is not connected yet. Your selected pod provides the context for this conversation.
          </p><PodSettings v-if="creating" key="new" @selected="changed" /><span v-else class="badge">Not connected</span>
        </section>
        <section v-else-if="selected === 'Settings'" id="panel-Settings" role="tabpanel" aria-labelledby="tab-Settings">
          <PodSettings :selected-pod-id="podId" @selected="changed" />
        </section>
        <section v-else-if="selected === 'Resources'" id="panel-Resources" role="tabpanel" aria-labelledby="tab-Resources">
          <PodResources :key="podId" :selected-pod-id="podId" @discuss="master()" />
        </section>
        <section v-else-if="selected === 'Runs'" id="panel-Runs" role="tabpanel" aria-labelledby="tab-Runs">
          <PodRuns :key="podId" :selected-pod-id="podId" />
        </section>
        <section v-else id="panel-Knowledge" role="tabpanel" aria-labelledby="tab-Knowledge">
          <PodKnowledge v-if="pod" :key="podId" :pod-id="podId" @discuss="master()" /><article v-else class="card empty-panel">
            <h2>Supported findings</h2><p class="muted">
              Create a pod to collect knowledge with sources.
            </p>
          </article>
        </section>
      </div>
      <footer class="footer">
        <span><span class="status-dot" :class="{ warning: attention }" /> Worker {{ workerLabel.toLowerCase() }}</span><span>{{ currentRun ? 'A run is active' : 'Local workspace' }} · {{ pods.length }} pods</span>
      </footer>
    </main>
  </div>
</template>
