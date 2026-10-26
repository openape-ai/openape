<script setup lang="ts">
import type { BriefingV2 } from '../../shared/briefing'
import { calendarDate, calendarTime } from '../utils/briefing-calendar'

defineProps<{ mail: BriefingV2['emails'][number] }>()
</script>

<template>
  <details class="original">
    <summary>{{ mail.subject }} <span>· {{ mail.account }}</span></summary>
    <div class="original-body">
      <p class="byline">
        {{ mail.sender }}<br>{{ calendarDate(mail.receivedAt) }} · {{ calendarTime(mail.receivedAt) }} · {{ mail.account }}
      </p>
      <p>{{ mail.summary }}</p>
      <ul v-if="mail.informationItems?.length" aria-label="Enthaltene Informationen">
        <li v-for="item in mail.informationItems" :key="item.id">
          {{ item.text }}
        </li>
      </ul>
      <p v-if="mail.nextAction">
        {{ mail.nextAction }}
      </p>
      <p class="byline">
        Einordnung der Quelle: {{ mail.disposition }}
      </p>
      <div class="original-links">
        <a v-if="mail.url" :href="mail.url" target="_blank" rel="noopener noreferrer">E-Mail öffnen ↗</a>
        <a v-if="mail.approvalUrl" :href="mail.approvalUrl" target="_blank" rel="noopener noreferrer">Archivierung prüfen ↗</a>
      </div>
    </div>
  </details>
</template>

<style scoped>
.original { border-top: 1px solid var(--line); }
summary { cursor: pointer; padding: 12px 0; min-height: 44px; box-sizing: border-box; font-size: .9rem; font-weight: 500; }
summary span, .byline { color: var(--muted); font-size: .82rem; font-weight: 400; }
.original-body { padding: 0 0 16px; font-size: .95rem; white-space: pre-wrap; }
p { margin: 0 0 12px; }
ul { padding-left: 22px; }
li { margin-bottom: 8px; }
.original-links { display: flex; flex-wrap: wrap; gap: 8px 24px; }
a { color: var(--accent); display: inline-flex; align-items: center; min-height: 44px; }
summary:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
@media print { details::details-content { content-visibility: visible; height: auto; } }
</style>
