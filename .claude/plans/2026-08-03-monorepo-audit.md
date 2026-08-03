# Monorepo-Audit 2026-08-03 — Bestand, Legacy, Konsolidierung

Erhoben mit vier unabhängigen Analyse-Läufen (Landkarte, Legacy-Jagd, Over-Engineering,
Strategie). Alle strittigen Befunde wurden gegen `origin/main` nachgeprüft — der
Haupt-Checkout stand zum Zeitpunkt der Analyse 307 Commits zurück und hat mehrere
Fehlbefunde erzeugt (siehe „Verworfene Befunde").

Messbasis `origin/main`: 156.957 LOC Code (2.288 getrackte Dateien), davon 44.114 LOC
Tests → 112.843 LOC Produktcode. 1.754 Commits, erster Commit 2026-02-16.

## Kurzfassung

Die Vermutung „enorm viel Legacy Code" ist **nicht belegt**: belegbar toter oder
duplizierter Code sind **2,1 % des Produktcodes** (2.409 LOC, davon ~415 „sicher tot").
Für Legacy fehlt schlicht die Zeit — das Repo ist 5,5 Monate alt, 61 % der Code-Dateien
wurden in den letzten 60 Tagen angefasst. Null `.bak`-Dateien, praktisch kein
auskommentierter Code, ein einziges `@deprecated`, zwei echte TODO-Marker.

Der Eindruck hat trotzdem drei reale Ursachen, in dieser Reihenfolge:

1. **Doku-Drift** — die Doku beschreibt einen abgelösten Stand.
2. **Duplikation** — junger Code, den es sieben Mal gibt.
3. **Gebaut, nie ausgeliefert** — fertige Features ohne Deployment-Pfad.

## Was das Monorepo kann

**In Produktion (chatty, tested images):** free-idp `:3003`, troop `:3010`, chat `:3007`,
tasks `:3005`, plans `:3004`, testrun `:3006`, timetrack `:3011`, pr `:3014`,
monitor `:3018`, question-service `:3017`, dazu die Docs-Site über einen eigenen
Deploy-Pfad. Deploy mit Health-Gate und Auto-Rollback.

**Auf npm:** 25 Packages, lokal und Registry in sync.

**Tragende Schicht ist die Identität:** alle 10 Prod-Apps laufen auf
`@openape/nuxt-auth-sp`, 14 Workspaces hängen an `@openape/cli-auth`, `@openape/core`
hat 20+ Konsumenten. Kein Deploy und kein CLI funktioniert ohne sie.

**Die Arbeit fließt woandershin:** Agenten-Kontrollebene zu Protokoll-Kern steht bei
4,2 : 1 (536 zu 129 Commits in 90 Tagen); `apps/openape-troop` allein macht 51 % aller
Dateiänderungen der letzten 30 Tage aus.

## Die drei Ursachen im Detail

### 1. Doku-Drift

| Ort | Behauptung | Realität |
| --- | --- | --- |
| `CLAUDE.md`, `CONTRIBUTING.md`, 2× `DEPLOY.md`, `.forgejo/workflows/deploy.yml` | rsync/systemd-Deploy | seit 2026-06-10 tested images |
| `CLAUDE.md` | `deploy.mjs` bleibt „für docs" | `deploy.mjs` kennt docs nicht (eigener Pfad seit 2026-06-12) |
| `ARCHITECTURE.md` | `packages/browser`, `packages/idp-test-suite` | seit 2026-06-26 gelöscht |
| `ARCHITECTURE.md` | „three self-hosted Nuxt web apps" | zehn Services |
| `apps/docs/content/5.apps/4.coder.md` | coder als Produkt | nicht deployed |
| Doku gesamt | — | monitor und question-service fehlen, laufen aber prod |
| `.forgejo/workflows/deploy.yml` | Target `org` | 2026-06-19 entfernt |
| `stories/README.md` | User-Stories sind „die einzige Hand-Eingabe" | seit 2026-06-12 tot (0 von 318 Commits) |

Das ist der billigste Fix mit der größten Wirkung auf den gefühlten Zustand.

### 2. Duplikation statt Legacy

Die sieben Proof-Link-SP-Apps sind Copy-Paste-Geschwister. Geteilt wird nur
`@openape/nuxt-auth-sp` (Login/Session); alles andere ist pro App kopiert.

| Messung | Wert |
| --- | --- |
| `server/database/drizzle.ts`, `tsconfig.json` | byte-identisch in 7/7 Apps |
| `server/api/health.get.ts`, `server/utils/problem.ts` | byte-identisch in 6 Apps |
| Team-/Invite-Endpunkte tasks ↔ plans | 8 Dateien byte-identisch |
| CLI `commands/teams.ts` tasks ↔ plans | 347 LOC, 26 Diff-Zeilen (96 % gleich) |
| Guide-Shell (`GuideShell.vue`, `docs/[story].vue`, `docs/index.vue`, `build-docs.mjs`) | 9× handgepflegt, 4–6 Zeilen Unterschied |
| Boot-DDL in `server/plugins/02.database.ts` | 1.189 LOC handgeschriebenes DDL, das 1.445 LOC Drizzle-Schema nachbaut |
| Pfadgleicher Anteil | tasks 76 %, plans 70 %, question-service 54 % |

Gegenbeweis im selben Repo: `openape-monitor` ist eine vollständige SP-App in
1.026 LOC, `tasks` liegt bei 4.319.

Bei den CLIs ist die Konsolidierung halb passiert: `@openape/proof-cli` (469 LOC) wird
von 5 der 6 CLIs konsumiert, aber nur an drei Stellen (`cli.ts`, `client.ts`,
`output.ts`); `teams.ts`, `api.ts`, `accept.ts`, `open.ts` sind kopiert.

### 3. Gebaut, nie ausgeliefert

| Kandidat | Umfang | Befund |
| --- | --- | --- |
| coder-Linie (App + CLI) | ~5.400 LOC | kein Prod-Deploy-Target, CLI nicht auf npm, null Konsumenten — wird aber weiter versioniert und in der Doku beworben |
| `packages/vue-components` | 1.272 LOC | null Konsumenten im Repo seit Löschung von `apps/idp` (2026-06-03); Dreifach-Dublette gegen `nuxt-auth-idp` |
| troop `pod/hatch` + `cloud/exoscale` | ~400 LOC | wirft bedingungslos 501, keine Aufrufer, `EXOSCALE_API_*` nirgends gesetzt |
| troop Web-Push | Tabelle + Utils + 2 Deps | kein PWA-Modul, kein Service-Worker, VAPID nie provisioniert |
| troop `cost_snapshots` | Tabelle + 2 Routen + UI-Tab | nichts schreibt je einen Snapshot |
| `SpawnAgentDialog.vue` | 595 LOC | null Konsumenten (Spawning läuft über CLIs) |
| `apps/openape-llm` | Dockerfile | kein Workspace-Inhalt, kein Deploy-Target |

**Korrektur zu troop Web-Push (Maßnahme 4):** Der Befund war falsch. Der Pfad ist
vollständig verdrahtet und live: `app/pages/chat.vue` registriert den
handgeschriebenen Service-Worker `public/sw.js`, holt die Berechtigung, abonniert
und postet an `/api/push/subscribe`; `server/utils/cockpit/chat-store.ts` ruft bei
jeder Operator-Antwort `pushToOwner()`. `NUXT_VAPID_PRIVATE_KEY` ist auf chatty in
`projects/openape-troop/shared/.env` gesetzt. Richtig an der Beobachtung war nur,
dass kein PWA-*Modul* eingebunden ist — der Service-Worker liegt von Hand in
`public/`. Web-Push bleibt daher stehen.

## Der Test-Doppelgänger (eigener Punkt, verifiziert)

`packages/server` (2.650 LOC src + 4.382 LOC Tests) hat **null Produktions-Konsumenten**.
Die fünf Treffer in `modules/nuxt-auth-idp` sind Kommentare der Form
`// Canonical: @openape/server createTokenHandler`, **keine Importe** — verifiziert per
`git grep "from '@openape/server'"` gegen `origin/main`: kein Treffer im Runtime-Code.
Importiert wird das Package nur von `examples/e2e` und neun `apes`-Testdateien.

Der Fork ist bereits gedriftet (1 h vs. 8 h Token-TTL, keine Standing-Grants, kein
Pre-Approval-Hook). Die E2E-Suite testet damit eine ärmere Variante als die, die in
Produktion läuft, und die Kommentare behaupten das Gegenteil.

**Nicht blind löschen:** das Package ist auf npm publiziert (0.3.19), externe Konsumenten
sind nicht ausgeschlossen. Erst E2E auf den dev-mode-Boot gegen die echte App umstellen
(Harness existiert), dann entscheiden.

## knip ist blind, meldet aber grün

`pnpm knip` meldet 1 Item. Das ist ein Konfigurationsartefakt:

- `entry: apps/*/{app,server,shared}/**` → 45.365 LOC
- `entry: modules/*/src/runtime/**` → 13.932 LOC
- `entry: test/**/*.test.ts` je Package → jedes nur von seinem Test importierte Symbol gilt als benutzt

Zusammen sind **~41 % des Codes von der Analyse ausgenommen**. Mit
`--include-entry-exports`: 471 Items statt 1; nach Gegenprüfung bleiben **44 echt
unreferenzierte Exports** (25 in `apps/*` = 311 LOC echt tot, 19 in Packages = publizierte
Public API, bewusst behalten).

Deshalb stand `SpawnAgentDialog.vue` monatelang tot da, ohne dass knip anschlug.
`entry` für `apps/*` auf echte Einstiegspunkte verengen, `app/utils` und `server/utils`
nach `project` — das ist der billigste Einzelschritt des ganzen Audits.

**Korrektur (PR #1155, umgesetzte Maßnahme 3):** Die Zahl „44 echt unreferenzierte
Exports" hielt der Umsetzung nicht stand. Ein Teil davon waren Artefakte eines
knip-Bugs: knip teilt die Auto-Import-Map über Workspace-Grenzen hinweg, und bei
gleichnamigen Symbolen in mehreren Apps gewinnt der erste Registrant — die
Zwillinge in den anderen Apps melden sich dann als tot. Nachweislich **live** und
fälschlich gelistet waren `redeemHatchToken`, `resolveOwnerContext`,
`tryResolveCaller` und `createDrizzleYoloPolicyStore`. Der geschärfte Lauf steht
inzwischen auf 0 Items; jede verbleibende `ignore*`-Zeile in `knip.jsonc` begründet,
warum das Verdeckte für statische Analyse unsichtbar ist.

## Prozess-Befunde

- **Plan-Friedhof:** 69 Pläne, ~20 nachweislich umgesetzt. Checkbox-Status ist als Signal
  wertlos — vier vollständig gelieferte Pläne stehen bei 0 % (`skill-library`,
  `extract-shapes-package`, `konsolidierung-phase1-m0-m1`, `openape-ceo-telegram`).
  Verifiziert tot: `rename-apes-to-escapes` (0/8, seit 2026-03-21),
  `m4d-delegations-and-dashboard-ux` (zielt auf gelöschte App), `gateway-iac` (kein
  Artefakt), sechs `werkstatt-*`-Pläne.
- **`.claude/plans/` war seit 2026-07-17 unversioniert** — 16 Pläne existierten nur lokal
  auf einem Feature-Branch, darunter alle fünf `session-handover.md`. Mit diesem Commit
  behoben.
- **Zwei tote Prozess-Frameworks:** `stories/` + `.claude/agents/` (letzter Commit
  2026-06-11) und `.auto-code/` — beide behaupten, der Weg für Arbeitseingang zu sein.
- **Deploy-Incident 2026-07-21** (im Code dokumentiert): ein Deploy von einem 5 Tage alten
  Branch hat den proactive-operators-Stack aus prod entfernt. **Die Gegenmaßnahme ist
  gebaut und aktiv** (`scripts/deploy-image.mjs`, Guard gegen HEAD ohne `origin/main`).

## Verworfene Befunde (aus dem veralteten Checkout)

Diese Behauptungen tauchten in den Analyse-Läufen auf und sind **falsch**:

| Behauptung | Prüfung |
| --- | --- |
| `apps/openape-monitor` ist ungesicherter Prod-Code | auf `main` versioniert, 27 Dateien |
| Deploy-Guard ist uncommittet | steht auf `main`, greift |
| `vue-components` bricht den nächsten Release (0.2.9 vs 0.2.11) | main und npm beide 0.2.11 |
| Geisterverzeichnisse `apps/idp`, `packages/browser` | auf `main` 0 Dateien — nur lokaler Rest |

Alle vier haben dieselbe Wurzel: der Haupt-Checkout stand auf
`feat/agent-activity-logging`, 307 Commits hinter `main`. **Solange das so ist, ist jede
lokale Beobachtung unzuverlässig** — das gilt für Menschen und Agenten gleichermaßen.

## Maßnahmen, nach Verhältnis Aufwand zu Wirkung

1. **Checkout-Hygiene** (Minuten, risikoarm) — Haupt-Checkout auf `main`, unversionierte
   Pläne sichern, lokale Branches ausmisten. Ohne das stimmen Beobachtungen nicht.
2. **Doku-Drift beheben** (~1 h, risikoarm) — Deploy-Pfad in fünf Dateien, `ARCHITECTURE.md`
   auf zehn Services, monitor/question-service ergänzen, coder als nicht-deployed
   kennzeichnen, `stories/README.md` ehrlich machen.
3. **knip schärfen** (~1 h) — `entry` verengen, neu messen, die 44 toten Exports abräumen.
4. **Ship-or-delete entscheiden** (Owner-Entscheidung, kein technisches Problem) —
   coder-Linie, `vue-components`, cloud/hatch, Web-Push, `cost_snapshots`.
5. **SP-Apps konsolidieren** (groß, risikobehaftet, größter Gewinn) — SP-Preset-Modul +
   Teams-Modul + `drizzle-kit generate` statt Boot-DDL. Realistisch ~6.000 LOC. Lohnt nur,
   wenn danach keine achte App nach altem Muster entsteht.
6. **`packages/server` auflösen** — erst E2E umstellen, externe Konsumenten prüfen, dann
   entscheiden. Nicht blind löschen.

Nicht anfassen: die `/api/agent/*`-Aliase (live — jeder Agent-Token-Refresh über
`@openape/cli-auth` läuft darüber), `/api/nest/hatch` (dokumentierter Operator-Flow),
der dormante systemd-Fallback (bewusst gebaut), DDISA-Protokollkonformität (sieht
stellenweise nach Duplikat aus, ist Konformität).

## Der Satz, auf den es hinausläuft

Vier vollständig gelieferte Pläne stehen bei 0 % Checkboxen; die Doku beschreibt einen
Stand von vor zwei Monaten; knip meldet grün, weil es 41 % nicht anschaut. Das Repo weiß
nicht, was es kann — deshalb wird neu gebaut statt nachgeschaut. Das ist die gemeinsame
Wurzel aller drei Symptome, und die Maßnahmen 1 bis 3 adressieren genau sie.
