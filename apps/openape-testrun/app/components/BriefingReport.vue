<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Briefing } from '../../shared/briefing'

const props = defineProps<{ report: Briefing, version: number, latestVersion: number, editions: { version: number, date: string }[] }>()
const importantItems = computed(() => props.report.importantItems.filter(item => !props.report.emails.some(mail => mail.subject === item.title && mail.summary === item.summary)))
const nextActions = computed(() => props.report.nextActions.filter(action => !props.report.emails.some(mail => mail.nextAction === action.text)))
const sourceStatus: Record<string, string> = { fresh: 'Aktuell', stale: 'Veraltet', missing: 'Fehlt', error: 'Fehler', partial: 'Teilweise' }
const mailStatus: Record<string, string> = { action: 'Du bist am Zug', keep: 'Zur Information', archive: 'Archivierung vorgeschlagen' }
const ready = ref(false)
onMounted(() => { ready.value = true })
const theme = ref<'system' | 'light' | 'dark'>('system')
const selectedVersion = computed({
  get: () => props.version,
  set: (value: number) => { if (value !== props.version) window.location.search = `?v=${value}` },
})
const dateLabel = computed(() => new Intl.DateTimeFormat('de-AT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${props.report.editionDate}T12:00:00Z`)))
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const stale = computed(() => props.report.editionDate < today && props.version === props.latestVersion)
const orderedCalendar = computed(() => [...props.report.calendar].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)))
function time(value: string) { return new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function shortDate(value: string) { return new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', day: 'numeric', month: 'short' }).format(new Date(value)) }
</script>

<template>
  <div lang="de" class="briefing" :data-theme="theme">
    <div class="paper">
      <header class="masthead">
        <a class="brand" href="/reports"><span class="brand-mark" aria-hidden="true">o.</span> OpenApe <span>Reports</span></a>
        <div class="toolbar">
          <span class="private-label"><span aria-hidden="true">●</span> Private Ausgabe</span>
          <label class="sr-only" for="briefing-theme">Darstellung</label>
          <select id="briefing-theme" v-model="theme" :disabled="!ready" aria-label="Darstellung">
            <option value="system">
              Auto
            </option><option value="light">
              Hell
            </option><option value="dark">
              Dunkel
            </option>
          </select>
        </div>
      </header>
      <main>
        <section class="opening" aria-labelledby="briefing-title">
          <p class="kicker">
            Dein Morgen im Überblick
          </p>
          <p class="edition-date">
            {{ dateLabel }}
          </p>
          <h1 id="briefing-title">
            {{ report.title }}
          </h1>
          <p class="overview">
            {{ report.overview }}
          </p>
          <div class="edition-meta">
            <span>Erstellt um {{ time(report.generatedAt) }} · Wien</span><span>Ausgabe {{ version }}</span>
          </div>
          <p v-if="stale" class="notice">
            Neueste verfügbare Ausgabe · {{ shortDate(report.generatedAt) }}. Ein neuerer Bericht wurde noch nicht veröffentlicht.
          </p>
          <p v-if="version !== latestVersion" class="notice">
            Du liest eine frühere Ausgabe. <a :href="`?v=${latestVersion}`">Zur neuesten Ausgabe →</a>
          </p>
        </section>
        <nav class="section-nav" aria-label="Berichtsabschnitte">
          <a v-if="importantItems.length || nextActions.length" href="#focus">Im Fokus</a><a href="#inbox">Nachrichten</a><a href="#agenda">Kalender</a><a href="#repositories">Issues</a><a href="#sources">Quellen</a>
        </nav>
        <div v-if="importantItems.length || nextActions.length" id="focus" class="primary-grid">
          <section v-if="importantItems.length" class="focus section" aria-labelledby="focus-title">
            <div class="section-heading">
              <h2 id="focus-title">
                Wichtig für dich
              </h2>
            </div>
            <div v-if="!importantItems.length" class="empty">
              In den verfügbaren Quellen wurden keine wichtigen Punkte erkannt.
            </div>
            <article v-for="(item, index) in importantItems" :key="item.id" class="focus-item">
              <span class="item-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <div>
                <p v-if="item.priority === 'high'" class="priority">
                  Wichtig
                </p><h3>{{ item.title }}</h3><p>{{ item.summary }}</p><div class="source-links">
                  <a v-for="id in item.sourceIds" :key="id" :href="`#source-${id}`">{{ report.sources.find(source => source.id === id)?.label }}</a>
                </div>
              </div>
            </article>
          </section>
          <aside v-if="nextActions.length" class="actions section" aria-labelledby="actions-title">
            <p class="kicker">
              Was als Nächstes ansteht
            </p><h2 id="actions-title">
              Nächste Schritte
            </h2><p v-if="!nextActions.length" class="empty">
              Keine offenen Schritte erkannt.
            </p><ol>
              <li v-for="action in nextActions" :key="action.id">
                <p>{{ action.text }}</p><span v-if="action.dueDate" class="minor">Fällig am {{ action.dueDate }}</span><a v-if="action.url" :href="action.url" rel="noopener noreferrer" target="_blank">Quelle öffnen ↗</a>
              </li>
            </ol>
          </aside>
        </div>
        <section id="inbox" class="section inbox" aria-labelledby="inbox-title">
          <div class="section-heading">
            <h2 id="inbox-title">
              Deine Nachrichten
            </h2><span class="section-count">{{ report.emails.length }} ausgewählt</span>
          </div>
          <p v-if="!report.emails.length" class="empty">
            Keine relevanten Nachrichten in der verfügbaren Prüfung. Die Quellenabdeckung steht weiter unten.
          </p>
          <div class="mail-grid">
            <article v-for="mail in report.emails" :key="mail.account + mail.id" class="mail-card">
              <div class="mail-meta">
                <span>{{ mail.account }}</span><time>{{ shortDate(mail.receivedAt) }}</time>
              </div><p class="sender">
                {{ mail.sender }}
              </p><h3>{{ mail.subject }}</h3><p>{{ mail.summary }}</p><p v-if="mail.nextAction" class="mail-action">
                <strong>Dein nächster Schritt:</strong> {{ mail.nextAction }}
              </p><div class="mail-footer">
                <span class="tag">{{ mailStatus[mail.disposition] ?? mail.disposition }}</span><a v-if="mail.url" :href="mail.url" target="_blank" rel="noopener noreferrer">E-Mail öffnen ↗</a><a v-if="mail.approvalUrl" :href="mail.approvalUrl" target="_blank" rel="noopener noreferrer">Archivierung prüfen ↗</a>
              </div>
            </article>
          </div>
        </section>
        <section id="agenda" class="section agenda" aria-labelledby="agenda-title">
          <div class="section-heading">
            <h2 id="agenda-title">
              Dein Kalender
            </h2><span class="section-count">{{ report.calendar.length }} Termine</span>
          </div>
          <p v-if="!report.calendar.length" class="empty">
            Keine Termine in den erfassten Kalenderdaten. Beachte die Quellenabdeckung weiter unten.
          </p>
          <article v-for="event in orderedCalendar" :key="event.account + event.id" class="event">
            <div class="event-time">
              <strong>{{ event.allDay ? 'Ganztägig' : time(event.start) }}</strong><span>{{ event.allDay ? event.start : shortDate(event.start) }}</span>
            </div>
            <div class="event-detail">
              <p class="minor">
                {{ event.account }}
              </p><h3><a v-if="event.url" :href="event.url" target="_blank" rel="noopener noreferrer">{{ event.title }} ↗</a><span v-else>{{ event.title }}</span></h3><p v-if="event.location">
                {{ event.location }}
              </p><p v-if="!event.allDay" class="minor">
                Bis {{ time(event.end) }}
              </p>
            </div>
          </article>
        </section>
        <section id="repositories" class="section" aria-labelledby="issues-title">
          <div class="section-heading">
            <h2 id="issues-title">
              Offene Repository-Issues
            </h2><span class="section-count">{{ report.issues.length }} ausgewählte Issues</span>
          </div><p v-if="!report.issues.length" class="empty">
            Keine offenen Issues im erfassten Ausschnitt.
          </p><article v-for="issue in report.issues" :key="issue.url" class="issue">
            <span class="issue-dot" aria-hidden="true">○</span><div>
              <p class="minor">
                {{ issue.repository }} · #{{ issue.number }}
              </p><h3><a :href="issue.url" target="_blank" rel="noopener noreferrer">{{ issue.title }} ↗</a></h3>
            </div><time class="minor">{{ shortDate(issue.updatedAt) }}</time>
          </article>
        </section>
        <section id="sources" class="section sources" aria-labelledby="sources-title">
          <div class="section-heading">
            <h2 id="sources-title">
              Quellen und Abdeckung
            </h2>
          </div><p class="sources-intro">
            Diese Ausgabe basiert auf den zum Erstellungszeitpunkt verfügbaren Quellen. Fehlende Informationen werden ausdrücklich ausgewiesen.
          </p><div v-if="report.gaps.length" class="gap-list">
            <p v-for="(gap, index) in report.gaps" :key="index">
              <strong>{{ report.sources.find(source => source.id === gap.sourceId)?.label }}:</strong> {{ gap.reason }}<span v-if="gap.lastSuccessAt"> Zuletzt erfolgreich erfasst: {{ shortDate(gap.lastSuccessAt) }} {{ time(gap.lastSuccessAt) }}.</span>
            </p>
          </div><div class="source-grid">
            <article v-for="source in report.sources" :id="`source-${source.id}`" :key="source.id" class="source">
              <div><h3>{{ source.label }}</h3><span class="source-status" :data-status="source.status">{{ sourceStatus[source.status] }}</span></div><p>{{ source.coverage }}</p><p v-if="source.total !== undefined" class="minor">
                {{ source.total }} insgesamt<span v-if="source.limit !== undefined"> · Erfassungsgrenze {{ source.limit }}</span>
              </p><p class="minor">
                {{ source.collectedAt ? `Erfasst am ${shortDate(source.collectedAt)} um ${time(source.collectedAt)}` : 'Kein Erfassungszeitpunkt verfügbar' }}
              </p><a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">Quelle öffnen ↗</a>
              <a v-if="source.approvalUrl" :href="source.approvalUrl" target="_blank" rel="noopener noreferrer">{{ source.approvalCount }} Archivierungsvorschläge prüfen ↗</a>
            </article>
          </div>
        </section>
      </main>
      <footer class="footer">
        <div><strong>Mit Klarheit in den Tag.</strong><p>OpenApe Reports · Nur für dein Konto</p></div><div class="archive">
          <label for="briefing-edition">Frühere Ausgaben</label><select id="briefing-edition" v-model.number="selectedVersion" :disabled="!ready">
            <option v-for="edition in editions" :key="edition.version" :value="edition.version">
              {{ edition.date }} · Ausgabe {{ edition.version }}
            </option>
          </select>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.briefing { --paper:#f7f6f1;--ink:#213c36;--muted:#66716a;--line:#d7ddd4;--card:#fffefa;--accent:#326354;--soft:#e7eee3;--warn:#795728; background:var(--paper);color:var(--ink);min-height:100dvh;font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.01em;overflow-wrap:anywhere; }
.briefing[data-theme=dark] { --paper:#14231f;--ink:#e3e9de;--muted:#a3b2a7;--line:#35483f;--card:#1b2d26;--accent:#b4d5b9;--soft:#243a2d;--warn:#e4bd7d; }
@media(prefers-color-scheme:dark){.briefing[data-theme=system]{--paper:#14231f;--ink:#e3e9de;--muted:#a3b2a7;--line:#35483f;--card:#1b2d26;--accent:#b4d5b9;--soft:#243a2d;--warn:#e4bd7d;}}
.paper{max-width:1160px;margin:auto;padding:0 56px}.masthead{min-height:100px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);gap:18px}.brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:17px;letter-spacing:-.04em}.brand>span:last-child{font-weight:400;color:var(--muted)}.brand-mark{font-family:Georgia,serif;font-size:31px;background:var(--ink);color:var(--paper);width:39px;height:39px;line-height:29px;text-align:center;border-radius:50%}.toolbar{display:flex;align-items:center;gap:24px}.private-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.private-label>span{font-size:7px;color:var(--accent);margin-right:6px}select{font:inherit;font-size:12px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:7px 11px;max-width:100%}.opening{padding:64px 0 42px;max-width:850px}.kicker{text-transform:uppercase;letter-spacing:.15em;font-size:10px;font-weight:700;color:var(--accent);margin:0 0 20px}.edition-date{font-size:14px;color:var(--muted);margin:0 0 13px}h1{font:500 clamp(42px,5.5vw,68px)/1.08 Georgia,'Times New Roman',serif;letter-spacing:-.045em;margin:0 0 24px;max-width:15ch}h2{font:500 28px/1.25 Georgia,'Times New Roman',serif;letter-spacing:-.035em;margin:0}h3{font-size:17px;line-height:1.4;font-weight:600;margin:0 0 8px}p{margin:0 0 12px}.overview{font-size:19px;line-height:1.7;color:var(--muted);max-width:67ch}.edition-meta{display:flex;gap:22px;font-size:11px;color:var(--muted);margin-top:24px}.notice{border-left:2px solid var(--warn);padding:10px 16px;font-size:13px;margin:24px 0 0;color:var(--warn)}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:4px}a:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:5px}.section-nav{display:flex;gap:30px;padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:12px;flex-wrap:wrap;color:var(--muted)}.section{padding:40px 0;border-bottom:1px solid var(--line);scroll-margin-top:20px}.section-heading{display:flex;gap:14px;align-items:baseline;margin-bottom:26px;flex-wrap:wrap}.section-number{font-size:10px;letter-spacing:.1em;color:var(--muted)}.section-count{margin-left:auto;font-size:11px;color:var(--muted)}.primary-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(0,1fr);gap:40px}.focus-item{display:grid;grid-template-columns:24px minmax(0,1fr);gap:14px;margin-top:24px}.item-index{font-family:Georgia,serif;font-size:18px;color:var(--muted)}.focus-item p{font-size:14px;color:var(--muted)}.focus-item .priority{font-size:9px;text-transform:uppercase;letter-spacing:.13em;color:var(--warn);margin-bottom:5px}.source-links{display:flex;gap:12px;flex-wrap:wrap;font-size:10px;color:var(--accent)}.actions{background:var(--soft);align-self:start;padding:28px;border:0;border-radius:4px;margin-top:40px}.actions .kicker{margin-bottom:10px}.actions h2{font-size:26px}.actions ol{list-style:decimal;padding-left:18px;margin:24px 0 0}.actions li{font-size:14px;padding-left:7px;margin:0 0 20px}.actions li::marker{font-size:11px;color:var(--muted)}.actions li:last-child{margin-bottom:0}.actions li p{margin-bottom:5px}.actions a{font-size:11px;display:block;color:var(--accent);margin-top:6px}.minor{font-size:11px;color:var(--muted)}.empty{color:var(--muted);font-size:14px;padding:12px 0}.event{display:grid;grid-template-columns:100px minmax(0,1fr);gap:22px;margin-left:25px;padding:0 0 28px}.event:last-child{padding-bottom:0}.event-time{display:flex;flex-direction:column;align-items:flex-end;font-size:11px;color:var(--muted);padding-top:3px}.event-time strong{font-size:18px;font-weight:500;color:var(--ink)}.event-detail{border-left:1px solid var(--line);padding-left:25px;position:relative}.event-detail:before{content:'';width:7px;height:7px;border-radius:50%;background:var(--accent);position:absolute;left:-4px;top:12px}.event-detail p{margin-bottom:4px;font-size:12px}.mail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.mail-card{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:24px;display:flex;flex-direction:column}.mail-meta{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:10px;margin-bottom:20px}.sender{font-size:11px;color:var(--accent);margin-bottom:5px}.mail-card>p{font-size:13px;color:var(--muted)}.mail-card .mail-action{padding-top:10px;color:var(--ink)}.mail-footer{display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:10px;margin-top:auto;padding-top:12px;color:var(--accent)}.tag{border:1px solid var(--line);border-radius:20px;padding:2px 9px;color:var(--muted)}.issue{display:flex;gap:16px;padding:18px 0;border-top:1px solid var(--line)}.issue:first-of-type{border-top:0}.issue-dot{color:var(--accent);font-size:23px;line-height:1.2}.issue>div{flex:1;min-width:0}.issue h3{font-size:15px;margin-bottom:0}.issue p{margin-bottom:3px}.issue>time{white-space:nowrap}.sources-intro{color:var(--muted);font-size:13px;max-width:62ch}.source-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px;margin-top:28px}.source>div{display:flex;gap:12px;align-items:baseline;justify-content:space-between}.source h3{font-size:13px}.source p{font-size:12px;color:var(--muted);margin-bottom:5px}.source a{font-size:11px;color:var(--accent)}.source-status{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--warn)}.source-status[data-status=fresh]{color:var(--accent)}.gap-list{border-left:2px solid var(--warn);padding:12px 20px;margin-top:20px;color:var(--warn);font-size:13px;background:var(--soft)}.gap-list p:last-child{margin-bottom:0}.footer{padding:34px 0 50px;display:flex;justify-content:space-between;gap:24px}.footer strong{font-family:Georgia,serif;font-size:17px;font-weight:500}.footer p{font-size:10px;color:var(--muted);margin-top:8px}.archive{display:flex;flex-direction:column;gap:8px;font-size:10px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
@media(max-width:700px){.paper{padding:0 24px}.masthead{min-height:78px}.brand{font-size:14px;gap:7px}.brand-mark{width:32px;height:32px;font-size:26px;line-height:25px}.private-label{display:none}.opening{padding:38px 0 30px}h1{font-size:44px}.overview{font-size:16px}.edition-meta{font-size:10px;gap:14px}.section-nav{gap:20px;font-size:11px}.primary-grid{display:block}.section{padding:30px 0}.actions{padding:24px;margin:22px 0 8px}.section-heading{gap:10px;margin-bottom:22px}h2{font-size:25px}.section-count{font-size:10px}.event{margin-left:0;grid-template-columns:68px minmax(0,1fr);gap:14px}.event-detail{padding-left:18px}.event-time strong{font-size:16px}.mail-grid,.source-grid{grid-template-columns:1fr}.mail-card{padding:20px}.issue>time{display:none}.footer{flex-direction:column;padding-bottom:35px}.archive{max-width:240px}.source-grid{gap:24px}.source-links{font-size:11px}}
@media print{.toolbar,.section-nav,.archive{display:none}.briefing{--paper:white;--ink:black;--muted:#444}.paper{padding:0}.section{break-inside:avoid}.mail-card{break-inside:avoid}}
</style>
