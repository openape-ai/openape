<script setup lang="ts">
import { onMounted, ref, watch, nextTick } from 'vue'
import 'highlight.js/styles/github-dark.css'

const { messages, isStreaming, companies, currentCompany, selectCompany, send, stop, clear } = useCockpitChat()
const { mode, label: presenceLabel, title: presenceTitle, start: startPresence, refresh: refreshPresence } = useCockpitPresence()
// Bootstrap prompt that fetches + follows the worker setup, so the user can bring
// their Operator online (headless or in-session) without typing. Shown as copyable
// text in a popup (the claude-cli:// deep link only works with Claude Code installed).
const workerPrompt = 'Set up the OpenApe worker on this machine: fetch https://troop.openape.ai/worker/setup.md and follow it. It asks whether to run in this session or install permanently, then makes my Operator live.'
const workerDeepLink = `claude-cli://open?q=${encodeURIComponent(workerPrompt)}`
const showWorkerDialog = ref(false)
const promptCopied = ref(false)
async function copyWorkerPrompt(): Promise<void> {
  await navigator.clipboard.writeText(workerPrompt)
  promptCopied.value = true
  setTimeout(() => { promptCopied.value = false }, 2000)
}
const scroller = ref<HTMLElement | null>(null)
const { showPill, onScroll, scrollToBottom, autoStick } = useCockpitScroll(scroller)
useKeyboardInset()
onMounted(startPresence)

// WhatsApp-style day separator before the first message of each day.
function dayLabel(ms: number): string {
  const d = new Date(ms)
  const start = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000)
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Gestern'
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}
function daySep(i: number): string {
  const ms = messages.value[i]?.createdAt
  if (!ms) return ''
  const prev = messages.value[i - 1]?.createdAt
  if (prev && new Date(prev).toDateString() === new Date(ms).toDateString()) return ''
  return dayLabel(ms)
}

function onCompanyChange(e: Event): void {
  void selectCompany((e.target as HTMLSelectElement).value)
}
function onSend(text: string): void {
  void send(text)
  void refreshPresence()
  void nextTick(() => scrollToBottom(false))
}
watch(messages, () => { void nextTick(autoStick) }, { deep: true })
</script>

<template>
  <div class="cockpit-root">
    <div class="chat" :style="{ '--accent': currentCompany?.accent ?? '#6d5efc' }">
      <header class="chat-header">
        <NuxtLink to="/companies" class="ghost nav-back" title="Zur troop-Steuerung" aria-label="Zur troop-Steuerung">
          ‹ troop
        </NuxtLink>
        <span class="avatar" :style="{ background: currentCompany?.accent ?? '#6d5efc' }">{{ currentCompany?.short ?? '··' }}</span>
        <span class="conn-dot" :class="`m-${mode}`" :title="presenceTitle">{{ presenceLabel }}</span>
        <button
          v-if="mode === 'offline'"
          class="ceo-start"
          type="button"
          title="Zeigt den Setup-Prompt für Claude Code oder codex"
          style="font-size:12px;padding:2px 8px;border:1px solid var(--accent);border-radius:999px;color:var(--accent);background:transparent;white-space:nowrap"
          @click="showWorkerDialog = true"
        >▸ Operator starten</button>
        <div class="company-picker">
          <select
            class="company-select"
            :value="currentCompany?.id ?? ''"
            aria-label="Firma wählen"
            @change="onCompanyChange"
          >
            <option v-if="!companies.length" value="">
              Keine Firmen
            </option>
            <option v-for="c in companies" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>
        </div>
        <button v-if="messages.length" class="ghost" type="button" @click="clear">
          Neu
        </button>
      </header>

      <div ref="scroller" class="messages" @scroll="onScroll">
        <div class="messages-inner">
          <p v-if="!companies.length" class="empty">
            Keine Firmen gefunden — bist du eingeloggt?
          </p>
          <p v-else-if="!messages.length" class="empty">
            Frag {{ currentCompany?.name }} etwas – die Antwort streamt live herein.
          </p>
          <template v-for="(m, i) in messages" :key="m.id">
            <div v-if="daySep(i)" class="date-sep">
              <span>{{ daySep(i) }}</span>
            </div>
            <CockpitBubble :message="m" />
          </template>
        </div>
      </div>

      <Transition name="pill">
        <button v-if="showPill" class="scroll-pill" type="button" @click="scrollToBottom(true)">
          ↓ Neueste
        </button>
      </Transition>

      <CockpitComposer :streaming="isStreaming" @send="onSend" @stop="stop" />

      <div v-if="showWorkerDialog" class="worker-dialog-backdrop" @click.self="showWorkerDialog = false">
        <div class="worker-dialog" role="dialog" aria-label="Operator starten">
          <h3>Operator starten</h3>
          <p>
            Kopiere den Prompt und füge ihn in <strong>Claude Code</strong> oder <strong>codex</strong>
            auf deiner Maschine ein. Wichtig: <a href="https://developers.openai.com/codex/cli" target="_blank" rel="noopener"><strong>codex muss installiert sein</strong></a> —
            der Worker nutzt codex als Backend, auch wenn du das Setup mit Claude Code startest.
          </p>
          <pre class="worker-prompt">{{ workerPrompt }}</pre>
          <div class="worker-dialog-actions">
            <button type="button" class="primary" @click="copyWorkerPrompt">
              {{ promptCopied ? '✓ Kopiert' : 'Prompt kopieren' }}
            </button>
            <a :href="workerDeepLink">In Claude Code öffnen</a>
            <button type="button" class="ghost" @click="showWorkerDialog = false">
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
