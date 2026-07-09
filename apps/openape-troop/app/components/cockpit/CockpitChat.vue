<script setup lang="ts">
import { onMounted, ref, watch, nextTick } from 'vue'
import 'highlight.js/styles/github-dark.css'

const { messages, isStreaming, companies, currentCompany, selectCompany, send, stop, clear } = useCockpitChat()
const { mode, label: presenceLabel, title: presenceTitle, start: startPresence, refresh: refreshPresence } = useCockpitPresence()
const scroller = ref<HTMLElement | null>(null)
const { showPill, onScroll, scrollToBottom, autoStick } = useCockpitScroll(scroller)
useKeyboardInset()
onMounted(startPresence)

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
          <CockpitBubble v-for="m in messages" :key="m.id" :message="m" />
        </div>
      </div>

      <Transition name="pill">
        <button v-if="showPill" class="scroll-pill" type="button" @click="scrollToBottom(true)">
          ↓ Neueste
        </button>
      </Transition>

      <CockpitComposer :streaming="isStreaming" @send="onSend" @stop="stop" />
    </div>
  </div>
</template>
