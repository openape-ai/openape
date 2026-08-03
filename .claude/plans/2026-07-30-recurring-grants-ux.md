# Wiederkehrende Grants stabil bekommen — reasonable Anzahl, gute UX

> Ziel (Patrick, 30.07.): Es muss möglich sein, das stabil zu bekommen — eine
> vernünftige Anzahl an Anfragen und erlaubten Sachen, gute UX. Heute: 31 pending
> Karten an einem Tag, ~11/Stunde vom Dev-Loop in Spitzen.

## Datenbasis (31 Karten vom 30.07., beide Inbox-Snapshots)

| Kategorie | Anzahl | Anteil |
|---|---|---|
| Forgejo-READ via curl+jq-Einzeiler (Issue/PR/CI-Status) | 16 | 52 % |
| Worktree/Patch (`apply_patch`-Heredoc, `git clone`, `ruby -e`) | 8 | 26 % |
| Mail/Kalender (delta-mind; 3 davon Stale-Policy-Altlasten) | 4 | 13 % |
| Forgejo-WRITE (Kommentar, Assign) | 2 | 6 % |
| Plumbing (`printf '' \| cockpit-agent.sh resolve` — Pipe-Form) | 1 | 3 % |

Nur **1** exaktes cmd_hash-Duplikat — Retries variieren die Kommandos leicht.
Dedupe per Hash lohnt also NICHT; TTL und Wrapper lohnen.

**Wurzelursache** (nicht die Policy!): Der Operator-Stil sind Einzeiler mit
`$( )`-Substitution, Loops und Heredocs — genau die Konstrukte, die der
YOLO-Evaluator **bewusst fail-closed** behandelt. Pending ist für den Operator
kein Lernsignal: Task endet, nächster Tick probiert eine Variante → Karte + Karte.

## Lösung in 5 Hebeln (empfohlene Reihenfolge)

### D. Directive-Regel „shell-einfach" (sofort, ~15 min)
Eine Regel in den Worker-Directive (Repo `apps/openape-troop/public/worker/`,
Drift-Check zieht sie nach): *Kommandos unter ape-shell sind EINFACH — keine
`$( )`, keine Loops, keine Heredocs, keine Pipes um Plumbing-Aufrufe. Ein
Kommando pro Zeile/Aufruf; was komplex ist, gehört in einen Wrapper.* Der
Operator (LLM) folgt dem, sobald es im Prompt steht.

### A. TTL für pending once-Grants (IdP, klein)
Pending `once`-Requests verfallen nach 48 h automatisch (`status: expired`,
raus aus der Inbox). Eine nie beantwortete Karte für einen CI-Poll von gestern
ist Lärm, kein Sicherheitsgewinn. Implementierung: Sweep im Grant-Store
(nuxt-auth-idp) beim Inbox-Read; kein Cron nötig.

### C. Fail-closed-Diagnose zurück an den Operator (apes/ape-shell, klein)
`pending_diagnostics` existiert seit #1109. ape-shell druckt bei pending
zusätzlich die Diagnose-Summary — insbesondere `substitution`-Segmente heißen:
**„wird NIE auto-approved — zerlege das Kommando oder nutze den Wrapper"**.
Damit kann der Operator IM Task reagieren statt blind zu retryen.

### B. `fj`-Wrapper für Forgejo-Verben (worker plumbing, mittel) → killt 58 %
Kleines Skript neben `cockpit-agent.sh` (gleicher Verteilweg, Drift-Check):
```
fj issue <nr>           # Issue-JSON (kuratierte Felder)
fj prs [--open]         # PR-Liste
fj pr <nr>              # PR + mergeable + head
fj ci <nr|sha> [--wait] # CI-Status, --wait pollt INTERN (ein Grant statt 6 Karten)
fj comment <nr> <file>  # Kommentar aus Datei (kein Heredoc)
fj assign <nr> <user>
```
Muster in die Rollen-tools/Plumbing: Reads in die Allow-Liste; ob
`fj comment`/`fj assign` auto-approved werden, ist eine Owner-Entscheidung
(Forgejo-intern, kein Mail-Send — Empfehlung: ja, das ist das normale
Arbeitsprodukt des Loops und war bisher jedes Mal ein Einzel-Approve).

### E. Worktree-Arbeit raus aus ape-shell (Architektur, Owner-Diskussion)
Die 26 % `apply_patch`/`git`-Karten sind der Dev-Loop, der versucht, ECHTE
Code-Arbeit durch das Kommando-Gate zu schieben. Das skaliert nicht — die
natürliche Grenze für Code-Arbeit ist der **PR-Review**, nicht jedes
Einzelkommando (auto-code-Muster: ephemerer Subagent im Worktree, volle lokale
Tools, gated am Push/PR). Vorschlag: Dev-Loop-Tasks vom Typ „Code ändern"
laufen als Worktree-Runner, ape-shell bleibt für Betriebs-/Lese-Kommandos.

## Erwartung nach D+A+C+B

- op-openape: von ~25/Tag auf **~0–2/Tag** (nur noch echte Ausnahmen; Worktree-
  Karten verschwinden erst mit E — bis dahin scheitern sie wenigstens laut mit
  Diagnose).
- op-delta-mind: **~0** — die Verben sind ohnehin erlaubt, es fehlte nur der
  Einzelkommando-Stil (Regel D) und die frische Policy (Drift-Anzeige live).
- Inbox zeigt nur noch Karten, die eine echte Entscheidung verlangen, und
  nichts Älteres als 48 h.

## Status

- [x] Analyse + Kategorisierung (31 Karten)
- [x] Drift-Anzeige im Cockpit (PR #1111) — Vorbedingung, damit „Policy stale"
      nie wieder wie „Karten-Problem" aussieht
- [x] D: Directive-Regel (#1115, live)
- [x] A: TTL-Sweep im IdP (#1112, nuxt-auth-idp 0.35.0, prod-82c78289)
- [x] C: Diagnose in ape-shell (#1113, apes 1.35.0 auf npm)
- [x] B: fj-Wrapper + Muster (#1115; comment/assign von Patrick freigegeben; Scope-Fix #1117)
- [x] E: code-task Worktree-Runner (#1120, prod-7f9b5fcf; E2E: Runner öffnete autonom PR #1119/#1121 für Issue #1118)

## Abschluss 2026-07-30 nachmittags

Alles außer E ist LIVE: free-idp + troop auf prod-82c78289/prod-15f21862, Worker
am Mini aktualisiert (fj installiert, drift == serviert). Live-Abnahme am
Delta-Mind-Org: erster yolo_report → inSync:true, Cockpit zeigt „Operator-Policy
aktuell (allow-list, 33 Muster)". Gefundene Falle: neue Agent-Route braucht
IMMER einen Scope-Catalog-Eintrag (403 trotz requireCockpitAgent, #1117);
fire-and-forget-Pfade bei der Abnahme einmal MIT sichtbarem Output fahren.
Forgejo-Phantom-Merge rezidivierte (#1114→#1115): Branch erst nach
main-Tip-Verifikation löschen (Memory aktualisiert).

## Hebel E umgesetzt (2026-07-30 abends)

`code-task start <issue-nr>` = Wegwerf-Worktree → codex sandboxed
(workspace-write, .git geschützt → Runner committet via COMMIT_MSG.txt) →
push → PR. Detached wegen Stall-Watchdog; Operator nutzt deferred + `code-task
status`. E2E am echten Issue #1118: Runner öffnete autonom den korrekten PR.
Worker am Mini aktualisiert (drift == serviert, ~/.local/bin/code-task).
ACHTUNG Forgejo: ZWEITER Phantom-Merge heute (#1114, #1119) — host-seitiger
Fix (data/tmp, Neustart) wird fällig; Workaround-Playbook steht in der Memory.
