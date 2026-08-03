# Session-Handover — 2026-07-15

> Für die Folge-Session. Lies das hier zuerst, dann den Plan
> `.claude/plans/2026-07-15-troop-memory-skills.md`. Detail-Wissen zum Worker steht im
> Memory-File `zaz-service-agent-setup.md` (Recall lädt es automatisch).

## 👉 Wo weitermachen (primär)

**Bau troop „Memory" (+ später „Skills").** Plan:
`.claude/plans/2026-07-15-troop-memory-skills.md` — 4 Milestones, Memory zuerst, Milestone 1 =
`memory`-Tabelle + company-scoped inline-Injection in `buildSystemPrompt`.

**Vor Milestone 1: Patrick muss 3 offene Fragen beantworten** (stehen am Ende des Plans):
1. Authoring: Memory nur in troop-UI, oder auch Import aus lokalen Files (buchhaltung.md → troop)?
2. Größen-Schwelle inline→reference (Vorschlag ~1500 Zeichen)?
3. role-Memory schon an delegierte Blätter (M3), oder vorerst CEO + Fetch-Endpoint?

**Nomenklatur-Entscheidung (Patrick, 2026-07-15):** troop übernimmt Claude-Konzept-Namen —
**Knowledge→Memory**, **Workflow→Skill**, Mitarbeiter≈Agent. Grund: Stakeholder-Verständnis. Beim
Bauen konsequent so benennen (Tabelle `memory`, Endpoint `…/agent/memory/[id]`, `cockpit-agent.sh memory <id>`).

## Live-Infrastruktur-Stand (NICHT kaputt machen)

- **openape-worker** läuft: launchd `at.openape.worker`, `~/.config/openape-worker/worker.sh`, **backend=codex**
  (plist `EnvironmentVariables: OPENAPE_WORKER_BACKEND=codex`). Bedient troop-Cockpit-Chat + zaz.
- **Codex-Engine:** CLI 0.144.4, Modell = config-Default `gpt-5.6-luna` (Patrick hat aktualisiert). **Gezähmt
  für Chat** (PR #955): `--disable collaboration_modes -c model_reasoning_effort=low` — sonst geht Codex in
  7-Min-Multi-Agent-„collab" für Ja/Nein-Fragen. `OPENAPE_WORKER_CODEX_EFFORT` env-tunebar.
- **Robustheit (alles heute gebaut, live):** 3 parallele Loops (heartbeat ‖ cockpit ‖ services), STALL-Timeout
  (killt nur bei echtem Stillstand `STALL_SECS`=150s, nicht Wall-Clock — ein arbeitender Task darf lange
  laufen), echte Zwischenberichte via `progress.py`/`codex_progress.py`, Retry (`GEN_RETRIES`=2) + sichtbare
  Fehlermeldung, `log()`→stderr (sonst leakt es in die Antwort).
- **Zwei Tracks:** worker.sh mit `OPENAPE_WORKER_BACKEND=claude|codex`; beide via Skill/setup.md installierbar.
- **cockpit-extra.txt** (PR #956): `~/.config/openape-worker/cockpit-extra.txt` wird an den Cockpit-Prompt
  gehängt — zeigt aktuell auf `~/.claude/commands/buchhaltung.md`. **Lokaler Vorläufer von Memory** — wird
  durch troop-Memory abgelöst, bleibt als Override.
- **Assets an 3 Orten synchron halten:** live `~/.config/openape-worker/`, Skill `~/.claude/skills/openape-worker/assets/`,
  hosted `apps/openape-troop/public/worker/` (letzteres braucht troop-Deploy).

## Git / Deploy — Regeln (wichtig)

- **origin = Forgejo** `https://git.openape.ai/openape-ai/openape.git` (kanonisch). `github` = read-only Mirror.
  **NIE github.com-Links** für dieses Repo. PR-URLs aus der API (`html_url`).
- **PR-Flow:** Branch pushen (`--no-verify`, pre-push-Hook failt auf unrelated WIP), PR via
  `POST /api/v1/repos/openape-ai/openape/pulls` (`--netrc-file ~/.netrc`), CI-Check = `CI / ci (pull_request)`,
  Merge via API `{"Do":"merge"}` (Merge-Commit; squash 500t manchmal).
- **Deploy:** `POST …/actions/workflows/deploy.yml/dispatches` mit `{"ref":"main","inputs":{"targets":"troop"}}`
  (targets: troop|free-idp|…). **Achtung: troop-Deploy startet troop neu** → in-memory Cockpit-Queue weg,
  laufende SSE/Tasks reißen ab. **Nicht deployen, während Patrick live im Chat ist** (heute genau das hat
  seine Nachrichten verschluckt).
- **main protected** — nur via PR.

## Was diese Session lief (Kurz-Arc)

Reihenfolge grob: injectionScore-Fix (#939, offen) → paralleler Worker + read-only Delegation (#944) →
Chat-Zeitstempel/Datums-Trenner (#945/#946) → Cockpit-Kontext letzte 20 Turns (#947) → Buchhaltungs-Writes
erlaubt (#948) → Login-Autofocus troop+free-idp (#949) → Hang-Absicherung Timeout/Progress/Heartbeat (#950) →
Retry + sichtbare Fehlermeldung (#951) → STALL-Timeout + stream-json Progress (#952) → Sentry nur in Prod
(#954, war ein Fehlalarm durch meinen lokalen free-idp-Dev-Server, KEIN Hack) → **Codex-Engine als 2. Track
(#953)** → Codex für Chat gezähmt (#955) → cockpit-extra.txt-Mechanismus (#956). **Alle gemerged + deployed.**

## Erledigt & verifiziert

- **Gehaltsabrechnung Juli 2026 komplett abgelegt** (physisch geprüft):
  `…/5_Verwaltung/2_Personalwesen/0_Lohnverrechnung/2026/07/` mit `Auswertungen 07_2026.zip` +
  entpacktem Ordner (Abrechnung/Auszahlungsjournal/Buchungsbeleg/Lohnnebenkostenliste 7-2026.pdf).
  Der CEO konnte das dank `buchhaltung.md`-Pointer — genau der Beweis für den Memory-Bedarf.

## Offene Threads (deferred, nicht vergessen)

- **#939 injectionScore-through-tree** — PR OFFEN/ungemerged (aus früherer Session).
- **SSE-Reconnect nach Abriss:** Client fällt bei Verbindungsabriss in Answer-only-Poll → Live-Progress
  verloren. Fix-Idee: Task-ID zum Client + `GET …/tasks/<id>/progress` + Re-attach. (Patrick will das.)
- **Codex-Zwischennachrichten als Progress-Text:** Codex emittiert `agent_message`-Zwischenschritte —
  `codex_progress.py` könnte deren Text durchreichen statt „✍️ formuliert" (billiger, großer Hebel).
- **Cockpit-Queue-Durabilität:** in-memory Map → bei troop-Restart weg. `resolve.post.ts` verwirft die
  Antwort still, wenn der Task nicht mehr im Memory ist. Fix: Queue persistieren (SQLite) oder Antwort auch
  ohne in-memory-Task speichern.
- **Ehrlichkeits-Beleg:** der Codex-CEO war bei der Ablage ehrlich („teilweise erledigt"), aber ein früherer
  Lauf hatte „erledigt" behauptet ohne zu tun — Guard hält meist, aber im Auge behalten (physisch verifizieren).

## Recall-Pointer

- Memory-File `zaz-service-agent-setup.md` = volle Worker-Architektur (parallele Loops, Backends, Timeout,
  Codex-Zähmung, alle PRs). Weitere: `openape-ci-forgejo.md` (Git/CI-Regeln), `deltamind-openape-team.md`.
