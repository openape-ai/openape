<script lang="ts">
import { defineComponent } from 'vue'
import type { PodStatus } from '../contracts/ipc'

export default defineComponent({
  data() {
    return {
      selected: 'Overview',
      tabs: ['Overview', 'Knowledge', 'Resources', 'Runs', 'Settings'],
      status: null as PodStatus | null,
      connectionError: '',
      unsubscribe: null as (() => void) | null,
    }
  },
  computed: {
    workerLabel(): string {
      if (this.connectionError) return 'Unavailable'
      return { starting: 'Starting', ready: 'Ready', error: 'Needs attention', stopped: 'Stopped' }[this.status?.worker.state ?? 'starting']
    },
    attention(): boolean { return !!this.connectionError || this.status?.worker.state === 'error' },
    panelDescription(): string {
      const copy: Record<string, string> = {
        Knowledge: 'Supported findings and their sources will appear here after the first authorized run.',
        Resources: 'No accounts, tools or reference files are connected. You will review each resource before granting access.',
        Runs: 'No runs yet. This workspace has not executed a script or read a mailbox.',
        Settings: 'This sample pod is manual only. Scripts, permissions and schedules will become configurable in later milestones.',
        'Master chat': 'The master will help you create and configure pods. Chat is not connected in this foundation build.',
      }
      return copy[this.selected] ?? ''
    },
  },
  async mounted() {
    try {
      this.unsubscribe = window.pods.onStatus((status) => { this.status = status })
      this.status = await window.pods.getStatus()
    }
    catch (error) { this.connectionError = error instanceof Error ? error.message : 'Could not reach the desktop worker' }
  },
  beforeUnmount() { this.unsubscribe?.() },
  methods: {
    selectTab(tab: string) { this.selected = tab },
    moveTab(event: KeyboardEvent, index: number) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length
      this.selected = this.tabs[next]
      ;(this.$refs.tabButtons as HTMLButtonElement[])[next].focus()
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
      <button class="nav-button" :class="{ active: selected === 'Master chat' }" @click="selectTab('Master chat')">
        <span aria-hidden="true">✦</span> Master chat <span class="nav-arrow" aria-hidden="true">↗</span>
      </button>
      <div class="sidebar-label">
        YOUR PODS <span>1</span>
      </div>
      <button class="pod-button" :class="{ active: selected !== 'Master chat' }" @click="selectTab('Overview')">
        <span class="pod-icon" aria-hidden="true">↗</span><span>Mail knowledge<small>Sample pod · Manual only</small></span>
      </button>
      <button class="new-pod" disabled title="Pod creation is not connected in this build">
        ＋ New pod
      </button>
      <div class="sidebar-bottom">
        <span class="status-dot" :class="{ warning: attention }" /><span>Running on this Mac<small>Fixture workspace</small></span>
      </div>
    </aside>
    <main class="main">
      <header class="toolbar">
        <span>Pods <span class="crumb" aria-hidden="true">/</span> Mail knowledge</span><span class="fixture-label">Fixture mode</span>
      </header>
      <div class="content">
        <div class="page-heading">
          <div>
            <p class="eyebrow">
              YOUR WORKSPACE
            </p><h1>Mail knowledge</h1><p class="subtitle">
              A place for context that lasts beyond a conversation.
            </p>
          </div><button class="primary" disabled title="Execution is disabled in fixture mode">
            Run once <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div class="fixture-note">
          <span aria-hidden="true">◌</span><p><strong>A safe place to get started.</strong> This is a sample workspace. No mailbox, account or tools are connected.</p>
        </div>
        <nav class="tabs" role="tablist" aria-label="Pod sections">
          <button v-for="(tab, index) in tabs" :id="`tab-${tab}`" ref="tabButtons" :key="tab" role="tab" :aria-selected="selected === tab" :aria-controls="`panel-${tab}`" :tabindex="selected === tab || (selected === 'Master chat' && index === 0) ? 0 : -1" @click="selectTab(tab)" @keydown="moveTab($event, index)">
            {{ tab }}
          </button>
        </nav>
        <section v-if="selected === 'Overview'" id="panel-Overview" role="tabpanel" aria-labelledby="tab-Overview">
          <div class="overview-grid">
            <article class="card assignment">
              <div class="card-heading">
                <h2>What this pod is here for</h2><span class="badge">Sample</span>
              </div><p class="assignment-text">
                Keep business matters current.<br>Keep the evidence close.
              </p><p class="muted">
                When connected, this pod will build sourced knowledge from mail, sent replies and attachments.
              </p><div class="card-footer">
                <span class="mini-label">ASSIGNMENT</span><span>Read-only mail knowledge</span>
              </div>
            </article>
            <article class="card worker-card">
              <div class="card-heading">
                <h2>Desktop worker</h2><span class="badge" :class="{ warning: attention }" role="status">{{ workerLabel }}</span>
              </div><div class="worker-visual" aria-hidden="true">
                <span class="worker-orbit">◉</span>
              </div><p class="worker-copy">
                {{ attention ? 'The worker needs your attention.' : 'Your workspace is ready to grow.' }}
              </p><p v-if="attention" class="error-message" role="alert">
                {{ connectionError || status?.worker.error }}
              </p><p v-else class="muted">
                The local worker is available.<br>Pod execution is disabled in this build.
              </p>
            </article>
          </div>
          <article class="card first-run">
            <span class="empty-icon" aria-hidden="true">⌁</span><div>
              <h2>No knowledge collected yet</h2><p class="muted">
                Findings and source references will appear after the first authorized run.
              </p>
            </div><button class="text-button" @click="selectTab('Resources')">
              View resources <span aria-hidden="true">→</span>
            </button>
          </article>
          <div class="next-step">
            <div>
              <p class="eyebrow">
                WHEN YOU ARE READY
              </p><h2>Give your pod its first assignment.</h2><p class="muted">
                The master will guide you through tools, context and permissions.
              </p>
            </div><button class="secondary" @click="selectTab('Master chat')">
              Open master chat <span aria-hidden="true">↗</span>
            </button>
          </div>
        </section>
        <section v-else-if="selected === 'Master chat'" class="card empty-panel" aria-label="Master chat">
          <span class="empty-icon" aria-hidden="true">✦</span><p class="eyebrow">
            CONTEXT · MAIL KNOWLEDGE
          </p><h2>Master chat</h2><p class="muted">
            {{ panelDescription }}
          </p><span class="badge">Not connected</span>
        </section>
        <section v-else :id="`panel-${selected}`" class="card empty-panel" role="tabpanel" :aria-labelledby="`tab-${selected}`">
          <span class="empty-icon" aria-hidden="true">⌁</span><h2>{{ selected }}</h2><p class="muted">
            {{ panelDescription }}
          </p><span class="badge">{{ selected === 'Settings' ? 'Manual only' : 'Nothing connected yet' }}</span>
        </section>
      </div>
      <footer class="footer">
        <span><span class="status-dot" :class="{ warning: attention }" /> Worker {{ workerLabel.toLowerCase() }}</span><span>No mailbox access · No scheduled runs</span>
      </footer>
    </main>
  </div>
</template>
