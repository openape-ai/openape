# Proactive Operators — Design & Plan

> Status: Phase 1 in Umsetzung (2026-07-16). Der Operator meldet sich von sich
> aus (statt nur auf Owner-Chat zu antworten) und erreicht Patrick aktiv per
> Web-Push in den Cockpit-Chat.

## Problem

Heute ist der Cockpit-Operator rein **reaktiv**: Patrick postet eine Nachricht,
der Operator (der always-on `openape-worker`) beantwortet sie. Es gibt keinen
Weg, auf dem der Operator *von sich aus* etwas anstößt und Patrick *erreicht*,
wenn er nicht gerade im Cockpit sitzt. Vorhandenes Gerüst (`cockpit_schedules` +
`/api/cockpit/due`) ist **nicht verdrahtet** und hat keinen Zustellkanal.

## Zielbild (die volle Architektur)

Drei **Trigger-Quellen** konvergieren auf **eine** geteilte Wirkung:

```
CRON  (Zeit, wiederkehrend) ─┐
TIMER (Zeit, einmalig)       ├─→  Operator-Prompt in Cockpit-Queue  →  Worker  →  Chat + Web-Push
HOOK  (externes HTTP-Event) ─┘        (die geteilte "Spine")
```

Alles rechts vom Pfeil (Enqueue → Worker-Brain → Chat + Push) wird **einmal**
gebaut. Die Trigger-Typen sind nur verschiedene Eingänge auf dieselbe Spine.

**Motor:** der always-on `launchd`-Worker (`at.openape.worker`, `KeepAlive`) ist
der Operator-Brain — er pollt die Cockpit-Queue ohnehin im Sekundentakt. Ein
proaktiver Task sieht für ihn aus wie ein normaler Cockpit-Task (orgId + Prompt),
also **keine worker.sh-Änderung**. troop bleibt der Orchestrator: ein
serverseitiger Evaluator legt fällige Trigger als Task in die Queue.

**Timer-Auflösung:** kein `setTimeout` (verliert Timer beim troop-Neustart).
Stattdessen ein persistenter **15-s-Tick** (Nitro-Startup-Plugin), der die
durable `cockpit_triggers`-Tabelle liest — deckt Sub-Minuten-Timer (~15 s genau)
UND übersteht Restarts, ein Evaluator für cron+timer.

## Phasing

| Phase | Inhalt | Beweist |
|---|---|---|
| **1 (dieser Plan)** | `cockpit_triggers` (cron+timer) + Trigger-CRUD + 15-s-Evaluator + Enqueue + Web-Push + Morgen-Digest **nur Delta Mind** | die ganze Spine end-to-end mit dem einfachsten Trigger |
| 2 (später) | Event-Hook-Endpoint (token-gebunden, HMAC, Rate-Limit) auf dieselbe Spine | die externe Quelle |
| 3 (später) | Trigger-CRUD als **Operator-Tools** (MCP) + Trigger-Verwaltungs-UI im Cockpit | Operator plant sich selbst |

## Phase 1 — Scope

**Alles in `apps/openape-troop`. Keine worker.sh-Änderung, kein 3-Wege-Asset-Sync.**

### Datenmodell (`server/database/schema.ts` + idempotente DDL in `02.database.ts`)

`cockpit_triggers` (ersetzt das ungenutzte `cockpit_schedules`):

| Feld | Typ | Zweck |
|---|---|---|
| id | text pk | |
| ownerEmail | text | Owner-Scope |
| orgId | text | Zielfirma |
| type | text | `'cron'` \| `'timer'` |
| prompt | text | Was der Operator tun soll (userMessage) |
| atHour | int? | cron: Wiener Stunde 0–23 (täglich) |
| everyMinutes | int? | cron: periodisch (Alternative zu atHour) |
| fireAt | int? | timer: epoch ms, einmalig |
| label | text | Anzeige (Phase-3-UI) |
| enabled | bool | |
| lastFiredAt | int? | Dedup / once-per-day |
| createdAt | int | |

> Cron = `atHour`/`everyMinutes` (reuse der getesteten `isDue`-Logik, **kein**
> Cron-Ausdruck-Parser in Phase 1). Volle `cronExpr`-Unterstützung
> (Wochentage/Minute) ist eine Phase-2-Erweiterung — hier bewusst ausgelassen
> (YAGNI: der Morgen-Digest braucht nur "täglich ab Stunde H").

`push_subscriptions`:

| Feld | Typ | Zweck |
|---|---|---|
| id | text pk | |
| ownerEmail | text | Owner-Scope |
| endpoint | text unique | Web-Push-Endpoint (ein Row pro Gerät/Browser) |
| p256dh | text | Subscription-Key |
| auth | text | Subscription-Auth |
| createdAt | int | |

### Bausteine

1. **`isDue`-Erweiterung** (`server/utils/cockpit/schedule.ts`): zusätzlich
   `type='timer'` → fällig wenn `fireAt <= now`. Cron unverändert. Reine Logik →
   unit-getestet.

2. **Trigger-Evaluator** (`server/plugins/03.trigger-evaluator.ts`,
   Nitro-Startup): `setInterval(15_000)`. Jeder Tick: enabled Trigger lesen; je
   fälligem → Org-Kontext bauen → `enqueue(orgId, systemPrompt, prompt, owner,
   origin='trigger')` → `lastFiredAt=now` setzen; `type='timer'` zusätzlich
   `enabled=false` (one-shot). Kein RAM-State; liest jeden Tick die DB (durable).
   Übersprungen bei `OPENAPE_E2E=1`.

3. **Org-Kontext-Helper** (`server/utils/cockpit/org-context.ts`, extrahiert aus
   `message.post.ts`): `buildOrgContext(db, owner, orgId)` → `{ org, systemPrompt }`.
   Sammelt org/objectives/team/memory/skills + `buildSystemPrompt(...)`. Sowohl
   `message.post` als auch der Evaluator nutzen es (keine 6 Queries doppelt).

4. **Queue `origin`** (`server/utils/cockpit/queue.ts`): `QueueTask.origin:
   'chat' | 'trigger'` (default `'chat'`); `enqueue(..., origin='chat')`.

5. **Push-Util** (`server/utils/cockpit/push.ts`): `setVapidDetails` aus Env
   (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
   `sendPushToOwner(owner, { title, body, url })` → alle Subscriptions des Owners;
   bei `410`/`404` die Row prunen. Fehlt VAPID-Env → no-op + Warnung (lokal
   lauffähig ohne Keys).

6. **Resolve-Push-Hook** (`server/api/cockpit/agent/tasks/resolve.post.ts`): bei
   `task.origin === 'trigger'` und terminalem `completed` mit Text → nach
   `saveChatMessage` `sendPushToOwner(...)` (Titel = Firmenname, Body =
   Digest-Anriss, url = Cockpit-Chat der Firma). Live-Chat-Antworten pushen NICHT
   (Owner schaut zu).

7. **Trigger-CRUD** (`server/api/cockpit/triggers.{get,post}.ts` +
   `triggers/[id].{patch,delete}.ts`), owner-gated wie Skills — legt/ändert/löscht
   Trigger. (Verwaltungs-UI ist Phase 3; die API ist Phase-1-Fundament + wird zum
   Seeden genutzt.)

8. **Push-Subscribe** (`server/api/cockpit/push/subscribe.post.ts` owner-gated,
   `unsubscribe.post.ts`, `vapid-public-key.get.ts`).

9. **Service-Worker** (`public/cockpit-sw.js`): `push`-Event → Notification;
   `notificationclick` → Cockpit-Chat öffnen/fokussieren.

10. **Subscribe-UI**: Button "🔔 Benachrichtigungen aktivieren" im Cockpit —
    registriert SW, `Notification.requestPermission`, `pushManager.subscribe` mit
    dem VAPID-Public-Key, POST an `subscribe`.

11. **Seed**: eine `cockpit_triggers`-Zeile via CRUD-POST — Delta Mind,
    `type='cron'`, `atHour=7`, Digest-Prompt.

### Digest-Prompt (userMessage des Triggers)

> „Erstelle Patricks Morgen-Briefing für **Delta Mind**. Sieh dir an, was
> ansteht: neue/wichtige Mails im Postfach (o365-cli, Konto laut Company-Memory),
> heutige Kalendertermine, offene/eskalierte Objectives. Fasse in **3–5 kurzen
> Sätzen** zusammen, was Patrick heute wissen muss — ehrlich und knapp; wenn nichts
> Nennenswertes ansteht, sag genau das in einem Satz."

### Fehlerfälle / Ceilings

- **Worker offline zur Feuerzeit:** Task liegt in der in-memory Queue; kommt kein
  Worker, ist der Digest für den Tag verpasst. `lastFiredAt` wird beim **Enqueue**
  gesetzt (fire-and-forget) → kein Duplikat-Stau. `// ponytail:` — proaktive
  Zustellung ist so zuverlässig wie die Queue; deren in-memory→SQLite-Durabilität
  ist ein separater, schon getrackter Thread.
- **Tote Push-Subscription (410/404):** beim Send prunen.
- **Fehlende VAPID-Env (lokal):** Push-Util = no-op, Rest läuft.
- **Tick-Overlap / verpasste Ticks:** Evaluator idempotent über `lastFiredAt`;
  cron matcht Wiener-Tagesfenster, nicht "exakt jetzt".
- **iOS-Web-Push:** funktioniert nur, wenn troop als PWA am Homescreen liegt
  (Apple-Restriktion). Desktop/Android ohne Weiteres. Setup-Schritt für Patrick,
  kein Blocker.

### Tests

- **`schedule.test.ts`**: `isDue` — cron daily (vor/nach atHour, `lastFiredAt`
  same-day-Dedup), periodic everyMinutes, timer `fireAt<=now`, disabled. Die
  einzige nicht-triviale Logik.
- **`push.test.ts`**: `sendPushToOwner` — 410-Antwort prunt die Subscription;
  fehlende Env = no-op. (web-push gemockt.)
- **Evaluator-Verhalten**: ein fälliger Trigger → genau ein Enqueue, danach nicht
  mehr fällig (lastFiredAt gesetzt); timer danach disabled.

## Prod-Rollout (braucht Patrick — nicht Teil des Merge)

1. VAPID-Keys generieren (`npx web-push generate-vapid-keys`), als Env auf chatty
   setzen (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:…`).
2. troop deployen (App-Änderung) — **im Fenster, nicht während Live-Chat**
   (resettet die Cockpit-Queue).
3. Im Cockpit "🔔 Benachrichtigungen aktivieren" tippen (pro Gerät; iPhone: troop
   vorher als PWA am Homescreen).
4. Delta-Mind-Digest-Trigger seeden (CRUD-POST oder Seed).
5. Prüfen: am nächsten Morgen (oder Test-Timer `fireAt=now+60s`) kommt Push +
   Chat-Message.

## Out of Scope (Phase 1)

Event-Hooks · Operator-Self-Scheduling-Tools (MCP) · Trigger-Verwaltungs-UI ·
volle Cron-Ausdrücke · andere Firmen als Delta Mind · Queue-Durabilität (SQLite).
