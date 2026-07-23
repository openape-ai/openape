<script setup lang="ts">
import { onMounted, ref, watch, nextTick } from 'vue'
import 'highlight.js/styles/github-dark.css'

const { messages, isStreaming, companies, currentCompany, selectCompany, send, answer, stop, clear } = useCockpitChat()
const { mode, missingTools, label: presenceLabel, title: presenceTitle, start: startPresence, refresh: refreshPresence } = useCockpitPresence()
// Deep link: opens Claude Code with a bootstrap that fetches + follows the worker
// setup, so the user can bring their Operator online (headless or in-session) without typing.
const workerDeepLink = `claude-cli://open?q=${encodeURIComponent(
  'Set up the OpenApe worker on this machine: fetch https://troop.openape.ai/worker/setup.md and follow it. It asks whether to run in this session or install permanently, then makes my Operator live.',
)}`
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

const showCompanies = ref(false)
function pickCompany(id: string): void {
  showCompanies.value = false
  void selectCompany(id)
}
function onSend(text: string, files: { id: string, mime: string, name: string }[] = []): void {
  void send(text, files)
  void refreshPresence()
  void nextTick(() => scrollToBottom(false))
}
watch(messages, () => { void nextTick(autoStick) }, { deep: true })
</script>

<template>
  <div class="cockpit-root">
    <div class="chat" :style="{ '--accent': currentCompany?.accent ?? '#6d5efc' }">
      <header class="chat-header">
        <button class="ghost nav-back" type="button" title="Firma wechseln" aria-label="Firma wechseln" @click="showCompanies = true">
          ‹
        </button>
        <span class="avatar" :style="{ background: currentCompany?.accent ?? '#6d5efc' }">{{ currentCompany?.short ?? '··' }}</span>
        <span class="conn-dot" :class="`m-${mode}`" :title="presenceTitle" :aria-label="presenceLabel"><span class="conn-label">{{ presenceLabel }}</span></span>
        <a
          v-if="mode === 'offline'"
          class="ceo-start"
          :href="workerDeepLink"
          title="Öffnet Claude Code und richtet den Operator-Worker ein — dann einmal Enter drücken"
          style="font-size:12px;padding:2px 8px;border:1px solid var(--accent);border-radius:999px;color:var(--accent);text-decoration:none;white-space:nowrap"
        >▸ Operator starten</a>
        <button class="company-title" type="button" aria-label="Firma wechseln" @click="showCompanies = true">
          {{ currentCompany?.name ?? 'Keine Firmen' }}
        </button>
        <button v-if="messages.length" class="ghost" type="button" @click="clear">
          Neu
        </button>
      </header>

      <p v-if="missingTools.length" class="sys-notice doctor-warn">
        ⚠ Beim Operator fehlen Werkzeuge: {{ missingTools.join(', ') }} — im Worker-PATH nicht gefunden.
      </p>

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
            <CockpitBubble :message="m" @answer="c => answer(m, c)" />
          </template>
        </div>
      </div>

      <Transition name="pill">
        <button v-if="showPill" class="scroll-pill" type="button" @click="scrollToBottom(true)">
          ↓ Neueste
        </button>
      </Transition>

      <CockpitComposer :streaming="isStreaming" :company="currentCompany?.id ?? ''" @send="onSend" @stop="stop" />

      <div v-if="showCompanies" class="services-overlay" @click.self="showCompanies = false">
        <div class="services-panel">
          <div class="services-head">
            <span class="services-title">Firmen</span>
            <button class="ghost" type="button" @click="showCompanies = false">
              Fertig
            </button>
          </div>
          <div class="services-list">
            <button
              v-for="c in companies"
              :key="c.id"
              class="company-row"
              :class="{ current: c.id === currentCompany?.id }"
              type="button"
              @click="pickCompany(c.id)"
            >
              <span class="avatar" :style="{ background: c.accent }">{{ c.short }}</span>
              <span class="company-row-name">{{ c.name }}</span>
            </button>
          </div>
          <NuxtLink to="/companies" class="services-note">
            troop-Steuerung ›
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
