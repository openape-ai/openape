<script setup lang="ts">
import { computed } from 'vue'
import type { BriefingTopic, BriefingV2 } from '../../shared/briefing'
import BriefingMailDetails from './BriefingMailDetails.vue'
import { calendarConflicts, calendarDate, calendarTime, occursOn } from '../utils/briefing-calendar'

const props = defineProps<{ report: BriefingV2 }>()
const focus = computed(() => props.report.topics.filter(topic => topic.placement === 'focus'))
const information = computed(() => props.report.topics.filter(topic => topic.placement === 'information'))
const today = computed(() => props.report.calendar.filter(event => occursOn(event, props.report.editionDate)))
const timedToday = computed(() => today.value.filter(event => !event.allDay))
const allDayToday = computed(() => today.value.filter(event => event.allDay))
const events = computed(() => [...props.report.calendar].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)))
const conflicts = computed(() => calendarConflicts(events.value))
const sourceLabel = (id: string) => props.report.sources.find(source => source.id === id)?.label
function originals(topic: BriefingTopic) {
  return props.report.emails.filter(mail => topic.references.some(ref => ref.account === mail.account && ref.emailId === mail.id))
}
const statusLabels = { complete: 'Vollständig', partial: 'Auswahl', unknown: 'Umfang unbekannt' }
</script>

<template>
  <div class="daily-overview">
    <aside class="coverage-note" aria-label="Umfang dieser Ausgabe">
      <p v-for="coverage in report.sourceCoverage" :key="coverage.account">
        <strong>{{ coverage.account }}:</strong>
        {{ coverage.considered === null ? 'Anzahl berücksichtigter Mailtexte unbekannt' : `${coverage.considered} Mailtexte berücksichtigt` }}<template v-if="coverage.available !== null">
          von {{ coverage.available }} {{ coverage.population === 'inbox' ? 'Inbox-Nachrichten' : 'Nachrichten mit offenen Informationen' }}
        </template>.
        <span v-if="coverage.status === 'unknown'"> Gesamtumfang unbekannt.</span>
        <span v-if="coverage.included !== coverage.considered"> {{ coverage.included }} im Bericht enthalten.</span>
      </p>
      <a href="#sources">Quellen und Grenzen ↓</a>
    </aside>
    <section v-if="focus.length" id="focus" class="overview-section" aria-labelledby="focus-title">
      <h2 id="focus-title">
        Im Fokus
      </h2>
      <article v-for="(topic, index) in focus" :key="topic.id" class="topic">
        <p class="topic-number">
          {{ String(index + 1).padStart(2, '0') }}
        </p>
        <h3>{{ topic.title }}</h3>
        <p class="topic-summary">
          {{ topic.summary }}
        </p>
        <p v-if="topic.rationale" class="rationale">
          {{ topic.rationale }}
        </p>
        <p v-if="topic.uncertainty" class="uncertainty">
          {{ topic.uncertainty }}
        </p>
        <BriefingMailDetails v-for="mail in originals(topic)" :key="mail.account + mail.id" :mail="mail" />
      </article>
    </section>
    <p v-else class="empty">
      Keine Schwerpunkte in dieser Auswahl. Die Quellenabdeckung zeigt den erfassten Umfang.
    </p>
    <section id="agenda" class="overview-section" aria-labelledby="agenda-title">
      <h2 id="agenda-title">
        Dein Kalender
      </h2>
      <p>{{ timedToday.length ? `${timedToday.length} Termine mit Uhrzeit heute` : 'Keine Termine mit Uhrzeit heute in den erfassten Kalendern.' }}</p>
      <p v-for="event in allDayToday" :key="event.account + event.id" class="all-day">
        Ganztägig: {{ event.title }} · {{ event.account }}
      </p>
      <div v-if="conflicts.length" class="conflicts">
        <h3>Überschneidungen im erfassten Zeitraum</h3>
        <p v-for="conflict in conflicts" :key="JSON.stringify([conflict.first.account, conflict.first.id, conflict.second.account, conflict.second.id])">
          <strong>{{ calendarDate(conflict.start) }} · {{ calendarTime(conflict.start) }}</strong><br>
          {{ conflict.first.title }} und {{ conflict.second.title }} überschneiden sich um {{ conflict.minutes }} Minuten.
        </p>
      </div>
      <details v-if="events.length" class="calendar-details">
        <summary>Kalendereinträge ansehen · {{ events.length }}</summary>
        <article v-for="event in events" :key="event.account + event.id" class="calendar-event">
          <p class="byline">
            {{ calendarDate(event.start) }} · {{ event.allDay ? 'Ganztägig' : `${calendarTime(event.start)}–${calendarTime(event.end)}` }} · {{ event.account }}
          </p>
          <h3>{{ event.title }}</h3>
          <p v-if="event.location">
            {{ event.location }}
          </p>
          <p v-if="event.allDay" class="byline">
            {{ event.start }} bis {{ event.end }} (Enddatum nicht enthalten)
          </p>
          <a v-if="event.url" :href="event.url" target="_blank" rel="noopener noreferrer">Termin öffnen ↗</a>
        </article>
      </details>
    </section>
    <section v-if="information.length" id="inbox" class="overview-section" aria-labelledby="information-title">
      <h2 id="information-title">
        Außerdem
      </h2>
      <details class="more-information">
        <summary>{{ information.length }} weitere Themen ansehen</summary>
        <article v-for="topic in information" :key="topic.id" class="topic secondary-topic">
          <h3>{{ topic.title }}</h3><p>{{ topic.summary }}</p>
          <p v-if="topic.rationale" class="rationale">
            {{ topic.rationale }}
          </p>
          <p v-if="topic.uncertainty" class="uncertainty">
            {{ topic.uncertainty }}
          </p>
          <BriefingMailDetails v-for="mail in originals(topic)" :key="mail.account + mail.id" :mail="mail" />
        </article>
      </details>
    </section>
    <section v-if="report.issues.length" class="overview-section" aria-labelledby="issues-title">
      <h2 id="issues-title">
        Repository-Issues
      </h2>
      <details>
        <summary>{{ report.issues.length }} ausgewählte Issues</summary><p v-for="issue in report.issues" :key="issue.url">
          <a :href="issue.url" target="_blank" rel="noopener noreferrer">{{ issue.repository }} #{{ issue.number }} · {{ issue.title }}</a>
        </p>
      </details>
    </section>
    <section id="sources" class="overview-section" aria-labelledby="sources-title">
      <h2 id="sources-title">
        Quellen und Grenzen
      </h2>
      <p v-for="gap in report.gaps" :key="gap.sourceId + gap.reason" class="uncertainty">
        <strong>{{ sourceLabel(gap.sourceId) }}:</strong> {{ gap.reason }}
      </p>
      <details>
        <summary>Erfassung im Detail</summary>
        <article v-for="coverage in report.sourceCoverage" :key="coverage.account" class="source-detail">
          <h3>{{ coverage.account }} · {{ statusLabels[coverage.status] }}</h3>
          <p>Grundgesamtheit: {{ coverage.population === 'inbox' ? 'Inbox-Nachrichten' : 'Nachrichten mit offenen Informationen' }}</p>
          <dl>
            <dt>Verfügbar</dt><dd>{{ coverage.available ?? 'Unbekannt' }}</dd>
            <dt>Metadaten erfasst</dt><dd>{{ coverage.scanned ?? 'Unbekannt' }}</dd>
            <dt>Mailtexte berücksichtigt</dt><dd>{{ coverage.considered ?? 'Unbekannt' }}</dd>
            <dt>Nachrichten im Bericht</dt><dd>{{ coverage.included ?? 'Unbekannt' }}</dd>
            <template v-if="coverage.population === 'open-information'">
              <dt>Vollständige Informationen</dt><dd>{{ coverage.informationItems ?? 'Unbekannt' }}</dd>
            </template>
          </dl>
        </article>
        <article v-for="source in report.sources" :key="source.id" class="source-detail">
          <h3>{{ source.label }}</h3><p>{{ source.coverage }}</p>
          <p class="byline">
            {{ source.collectedAt ? `Erfasst am ${calendarDate(source.collectedAt)} um ${calendarTime(source.collectedAt)}` : 'Kein Erfassungszeitpunkt verfügbar' }}
          </p>
          <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">Quelle öffnen ↗</a>
          <a v-if="source.approvalUrl" :href="source.approvalUrl" target="_blank" rel="noopener noreferrer">Archivierungsvorschläge prüfen ↗</a>
        </article>
      </details>
    </section>
  </div>
</template>

<style scoped>
.daily-overview { max-width: 800px; font-size: 1rem; }
h2 { font: 500 1.7rem/1.3 Georgia,serif; margin: 0 0 20px; }
h3 { font-size: 1.12rem; line-height: 1.4; margin: 0 0 10px; }
p { margin: 0 0 12px; }
a { color: var(--accent); display: inline-flex; align-items: center; min-height: 44px; }
summary { min-height: 44px; padding: 12px 0; box-sizing: border-box; cursor: pointer; color: var(--accent); }
summary:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.coverage-note { border-left: 3px solid var(--line); padding: 0 0 0 16px; color: var(--muted); font-size: .85rem; }
.coverage-note p { margin-bottom: 6px; }
.overview-section { padding: 32px 0; border-bottom: 1px solid var(--line); scroll-margin-top: 20px; }
.topic { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px; margin: 16px 0; }
.topic-number { font-size: .8rem; color: var(--accent); font-weight: 650; }
.topic-summary { font-size: 1.05rem; }
.rationale, .byline, .all-day { color: var(--muted); }
.uncertainty { color: var(--warn); font-size: .9rem; border-left: 2px solid var(--warn); padding-left: 12px; }
.conflicts { padding: 18px; background: var(--soft); border-radius: 10px; margin: 20px 0 8px; }
.conflicts h3 { color: var(--warn); }
.calendar-event, .source-detail { padding: 18px 0; border-top: 1px solid var(--line); }
.byline { font-size: .85rem; }
.secondary-topic { background: transparent; }
dl { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 6px 20px; font-size: .9rem; }
dd { margin: 0; }
.empty { color: var(--muted); padding-top: 24px; }
@media(max-width:700px) { .topic { padding: 18px; } h2 { font-size: 1.5rem; } }
@media print { details::details-content { content-visibility: visible; height: auto; } .topic { break-inside: avoid; } }
</style>
