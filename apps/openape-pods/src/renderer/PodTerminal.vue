<script lang="ts">
import { defineComponent, markRaw } from 'vue'
import { terminalDocument } from './terminal-document'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalView } from '../contracts/programs'
import { t, diagnostic } from './i18n'

export default defineComponent({
  props: { initial: { type: Object as () => TerminalView, required: true } },
  emits: ['closed', 'finished'],
  data() { return { terminal: null as Terminal | null, fit: null as FitAddon | null, observer: null as ResizeObserver | null, timer: null as ReturnType<typeof setTimeout> | null, view: this.initial, error: '', closed: false } },
  mounted() {
    const terminal = markRaw(new Terminal({ documentOverride: terminalDocument(), fontSize: 13, fontFamily: 'Menlo, monospace', scrollback: 1500, disableStdin: this.initial.state !== 'running', allowProposedApi: false, theme: { background: '#17201b', foreground: '#e4ece6' } }))
    const fit = markRaw(new FitAddon()); terminal.loadAddon(fit)
    terminal.open(this.$refs.surface as HTMLElement); this.terminal = terminal; this.fit = fit
    terminal.write(this.initial.output); fit.fit(); terminal.focus()
    terminal.onData((data) => { void this.input(data).catch((error: unknown) => this.fail(error)) })
    this.observer = new ResizeObserver(() => { fit.fit(); void this.resize().catch((error: unknown) => this.fail(error)) }); this.observer.observe(this.$refs.surface as HTMLElement)
    this.poll()
  },
  beforeUnmount() {
    this.closed = true; if (this.timer) clearTimeout(this.timer); this.observer?.disconnect(); this.terminal?.dispose()
    if (this.view.state !== 'closed') void window.pods.programs({ type: 'close', podId: this.view.podId, sessionId: this.view.sessionId }).catch((error: unknown) => { console.error('Terminal close failed', error) })
  },
  methods: {
    t, diagnostic,
    fail(error: unknown) { this.error = error instanceof Error ? error.message : 'Application terminal failed' },
    async input(data: string) { if (this.view.state === 'running') await window.pods.programs({ type: 'input', podId: this.view.podId, sessionId: this.view.sessionId, data }) },
    async resize() { if (this.view.state === 'running' && this.terminal) await window.pods.programs({ type: 'resize', podId: this.view.podId, sessionId: this.view.sessionId, columns: Math.max(20, Math.min(500, this.terminal.cols)), rows: Math.max(5, Math.min(300, this.terminal.rows)) }) },
    poll() {
      if (this.closed || this.view.state === 'closed') return
      this.timer = setTimeout(async () => {
        try {
          const next = await window.pods.programs({ type: 'poll', podId: this.view.podId, sessionId: this.view.sessionId, after: this.view.sequence }) as TerminalView
          if (this.closed) return
          this.terminal?.write(next.output); const started = this.view.state === 'starting' && next.state === 'running'; this.view = next
          if (this.terminal) this.terminal.options.disableStdin = next.state !== 'running'
          if (started) await this.resize()
          if (next.state === 'closed') this.$emit('finished')
        }
        catch (error) { this.fail(error); return }
        this.poll()
      }, 150)
    },
    async close() {
      try { this.view = await window.pods.programs({ type: 'close', podId: this.view.podId, sessionId: this.view.sessionId }) as TerminalView; this.$emit('closed') }
      catch (error) { this.fail(error) }
    },
  },
})
</script>

<template>
  <section class="pod-terminal" :aria-label="t('Application terminal')">
    <header>
      <strong>{{ t('Application terminal') }}</strong><button @click="close">
        {{ t(view.state === 'closed' ? 'Dismiss output' : 'Stop program') }}
      </button>
    </header>
    <p>{{ t('This terminal belongs to this pod and application. Closing it stops the program. No sign-in status is inferred.') }}</p>
    <p v-if="view.state !== 'closed'" role="status">
      {{ t(view.state === 'starting' ? 'Starting application…' : 'Application running') }}
    </p>
    <div ref="surface" class="terminal-surface" />
    <p v-if="view.state === 'closed'" role="status">
      {{ t('Program exited with code {code}', { code: view.exitCode ?? '—' }) }}
    </p>
    <p v-if="error || view.error" class="error-message" role="alert">
      {{ diagnostic(error || view.error) }}
    </p>
  </section>
</template>

<style scoped>
.pod-terminal { margin:20px 0; border:1px solid var(--border); border-radius:12px; padding:16px; }
header { display:flex; align-items:center; justify-content:space-between; gap:16px; }
p { font-size:13px; }
.terminal-surface { height:320px; padding:10px; background:#17201b; border-radius:6px; overflow:hidden; }
</style>
