<script lang="ts">
import { defineComponent } from 'vue'
import type { ConsoleView, TerminalView } from '../contracts/programs'
import PodTerminal from './PodTerminal.vue'
import { t, diagnostic } from './i18n'

export default defineComponent({
  components: { PodTerminal },
  props: { podId: { type: String, required: true }, application: { type: String, required: true } },
  emits: ['closed', 'updated'],
  data() { return { line: '', lastCommand: '', workspace: '', output: '', error: '', busy: true, active: false, disposed: false, terminal: null as TerminalView | null } },
  async mounted() {
    try {
      const context = await window.pods.programs({ type: 'prepare', podId: this.podId, line: this.application }) as ConsoleView
      this.workspace = context.workspace; this.output = context.output
    }
    catch (error) { this.fail(error) }
    finally { this.busy = false; await this.focus() }
  },
  beforeUnmount() { this.disposed = true },
  methods: {
    t, diagnostic,
    fail(error: unknown) { this.error = error instanceof Error ? error.message : 'Application terminal failed' },
    async focus() { await this.$nextTick(); if (!this.disposed) (this.$refs.command as HTMLInputElement | undefined)?.focus() },
    async finished() { this.active = false; await this.focus() },
    async submit() {
      if (this.busy || this.active || !this.line.trim()) return
      this.busy = true; this.error = ''
      try {
        const context = await window.pods.programs({ type: 'prepare', podId: this.podId, line: this.line }) as ConsoleView
        if (this.disposed) return
        this.workspace = context.workspace
        if (!context.command) { this.output = context.output; this.terminal = null; this.line = ''; return }
        const command = context.command
        if (context.needsGrant) {
          const state = await window.pods.programs({ ...command, type: 'grant' })
          if (!('resources' in state)) throw new Error('Application permission response is missing')
          this.$emit('updated', state)
          if (this.disposed) return
          const application = state.resources.find(item => item.id === command.applicationId && item.state === 'ready')
          const grants = application?.configuration.grants as { permission: string }[] | undefined
          if (!grants?.some(grant => grant.permission === context.permission)) return
          command.epoch = state.epoch
        }
        const terminal = await window.pods.programs(command) as TerminalView
        if (this.disposed) { await window.pods.programs({ type: 'close', podId: this.podId, sessionId: terminal.sessionId }); return }
        this.lastCommand = this.line; this.terminal = terminal; this.active = terminal.state !== 'closed'; this.line = ''; this.output = ''
      }
      catch (error) { this.fail(error) }
      finally { this.busy = false; if (!this.active) await this.focus() }
    },
  },
})
</script>

<template>
  <section class="pod-console" :aria-label="t('Pod terminal')">
    <header>
      <strong>{{ t('Pod terminal') }}</strong><button v-if="!active" class="text-button" @click="$emit('closed')">
        {{ t('Close terminal') }}
      </button>
    </header>
    <p class="console-workspace">
      <span>{{ t('Working directory') }}</span><code>{{ workspace }}</code>
    </p>
    <p class="muted">
      {{ t('Enter a complete command. Only assigned applications are available. Use help or pwd; shell operators are not supported.') }}
    </p>
    <details v-if="output" open>
      <summary>{{ t('Terminal output') }}</summary><pre>{{ output }}</pre>
    </details>
    <pre v-if="terminal" class="executed-command">{{ `pod $ ${lastCommand}` }}</pre>
    <PodTerminal v-if="terminal" :key="terminal.sessionId" :initial="terminal" @finished="finished" @closed="terminal = null; finished()" />
    <form v-if="!active" class="command-prompt" @submit.prevent="submit">
      <span aria-hidden="true">{{ t('pod $') }}</span><input ref="command" v-model="line" :aria-label="t('Terminal command')" :disabled="busy" :placeholder="`${application} …`" autocomplete="off" spellcheck="false"><button :disabled="busy || !line.trim()">
        {{ t('Run command') }}
      </button>
    </form>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
  </section>
</template>

<style scoped>
.pod-console { margin-top:16px; border-top:1px solid var(--border); padding-top:16px; }
header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
p, summary { font-size:13px; }
.console-workspace { display:grid; gap:5px; }
code, pre { font:12px/1.6 Menlo,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
.command-prompt { display:flex; gap:8px; align-items:center; padding:10px; background:#17201b; color:#e4ece6; border-radius:6px; font:13px Menlo,monospace; }
.command-prompt input { min-width:0; flex:1; background:transparent; color:inherit; border:0; font:inherit; padding:8px 0; }
.command-prompt button { flex-shrink:0; }
@media(max-width:600px) { .command-prompt { flex-wrap:wrap; } .command-prompt input { flex-basis:70%; } }
</style>
