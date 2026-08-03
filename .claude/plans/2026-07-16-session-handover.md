# Session-Handover — 2026-07-16

> Für die Folge-Session. Lies das zuerst. Die vorige Session war sehr lang und hat den troop-Operator-
> Kosmos stark ausgebaut. Detail-Wissen liegt in den Memory-Files (Recall lädt sie) und in
> `.claude/plans/2026-07-16-*.md`.

## Was diese Session geliefert hat (alles live + verifiziert)

**troop-Operator-Features** (PRs auf git.openape.ai/openape-ai/openape):
- **Memory** (#957): company/role/agent-scoped Memory → CEO/Operator-Prompt, inline + reference-fetch, CRUD+UI (Tab).
- **Skills** (#959): org-scoped Skills (name+description+prompt), per `assignedTo` an Agents, autonom per description.
- **SSE-Reconnect** (#960): Task-ID als erstes SSE-Event + `GET /api/cockpit/tasks/[id]/progress` → Client re-attached; 404→messages-Poll-Fallback.
- **Codex-Progress-Text** (#961): `codex_progress.py` reicht echten agent_message-Text durch statt „✍️ formuliert".
- **CEO→Operator-Rename** (#962): Anzeige „Operator" statt „CEO" (Prompt, Direktive, Progress, UI, Persona). **Daten-Key `role:'ceo'` unverändert.** Naming-Entscheidung: **Operator + Company** (Operation/Band verworfen).
- **Company-Isolation-Fix** (#963): globale Direktive war Delta-Mind-spezifisch → IURIO-Operator las delta-mind-Mail (Leak). Jetzt tool-agnostisch, Konto/Pfade aus Company-Memory. + **Kalender-Schreiben** freigegeben.
- **Mail-Archivieren** (#964): Operatoren dürfen im eigenen Postfach archivieren (reversibel).
- **Tool-agnostische Direktive** (#965), dann **Tooling via Skills** (#967): die Direktive nennt kein CLI mehr.
- **Owner-level Skill-Bibliothek** (#966): `cockpit_skills.orgId=''` = firmenübergreifend zuweisbare Tool-Skills; owner-level CRUD (`/api/cockpit/skills`) + `/api/cockpit/agents` + „Skills"-Ansicht (`/skills`). Tool-Skills **o365-cli**/**gmail-cli** geseedet + den Mail-Agents zugewiesen.
- **Agent-Activity-Logging** (#968): worker.sh loggt pro Cockpit-Task `op-auto` ins `~/.claude/activity-logs/` (Identität aus der `ACTIVITY-LOG:`-Memory-Zeile der Org); Directive weist `op-agent`-Detail an. Damit landet Operator-Arbeit in der invoice/timesheet-Pipeline.

**Firmen-Umbau (troop-Daten, live):**
- **OpenApe ist eigene Firma** (ex-„Werkstatt"): 5 Dev-Agents (Scrum Manager→Owner + Programmierer/Reviewer/Tester/Visual) aus Delta Mind verschoben. Delta Mind = nur Admin-Rollen.
- **Neue Firma „privat"**: Gmail (`patrick@hofmann.eco` via gmail-cli), Ablage `~/Companies/private/onedrive/` (Symlink→OneDrive privat), Mail-Assistent-Agent, Objectives (Google-Kalender-CLI + Reiseplaner).
- **Company-Memory je Firma = config-only** (Konto+Pfade). Mail-CLI: DM/IURIO→o365-cli, privat→gmail-cli (über die Tool-Skills). Konten: DM `phofmann@delta-mind.at`, IURIO `patrick@docpit.eu`, privat `patrick@hofmann.eco`.

**Lokale Tools (Patricks Maschine, kein troop):**
- **gmail-cli** hat jetzt ein eigenes Repo: `~/Companies/delta-mind/repos/gmail-cli/` + **public** github.com/patrick-hofmann/gmail-cli; `~/bin/gmail-cli` = Symlink. Neu: `mail archive`/`move` (himalaya), search-multi-word-Fix, `_usage`-Fix.
- **claude-log ist jetzt ein Script** `~/.local/bin/claude-log` (headless aufrufbar, JSON-sicher, optionaler 5. `sid`-Param); die zsh-Funktion in `~/.zsh_shared/commands/claude-log.zsh` delegiert dorthin.
- **Linde-Weiterleitungs-Rechnungen** (Bill-To=Linde, kommen über Exoscale ans DM-Postfach): Ordner `~/Companies/linde/documents/rechnungen-eingang/` + als erlaubter Pfad im DM-Memory + `buchhaltung.md`-Regel (nicht mehr Skip). `collect-activity.ts` (linde-invoices, lokaler Commit `8e2006d`) dedupt op-auto/op-agent.

## Live-Infrastruktur (NICHT kaputt machen)
- **openape-worker**: launchd `at.openape.worker`, backend=codex, `~/.config/openape-worker/`. worker.sh trägt: Policy-Direktive (tool-agnostisch, Kalender+Archiv erlaubt, LOGGING-Block), MEMORY/SKILLS-Hinweise, activity_backbone (op-auto). **Assets an 3 Orten synchron halten** (repo `apps/openape-troop/public/worker/`, `~/.config/openape-worker/`, `~/.claude/skills/openape-worker/assets/`). worker.sh **nie blind cp-en** — gezielt patchen bleibt der Reflex.
- **troop prod**: letzter App-Deploy = #966 (Skill-Bibliothek+UI). Alle worker-only-PRs (#963/#964/#965/#967/#968) brauchten keinen Deploy.

## Git/Deploy-Regeln (unverändert)
- origin = **Forgejo** `git.openape.ai/openape-ai/openape`; **nie github.com-Links** fürs Monorepo. PR via API (`--netrc-file ~/.netrc`), Merge `{"Do":"merge"}`, CI = `CI / ci` (+e2e+preview). **e2e ist flaky** (troop nicht im e2e-Pfad) → bei rotem e2e leerer Commit re-triggert.
- **Deploy** nur nötig bei troop-**App**-Änderung: `POST …/actions/workflows/deploy.yml/dispatches` `{"ref":"main","inputs":{"targets":"troop"}}`. **Startet troop neu → Cockpit-Queue weg; nicht deployen, während Patrick live im Chat ist.** Worker-Änderungen = sync+`launchctl kickstart -k gui/$(id -u)/at.openape.worker`, kein Deploy.

## Offene Threads (deferred)
- **op-agent-Detail-Zuverlässigkeit:** Mechanismus da (Directive), aber LLM-abhängig — beobachten ob Agents wirklich op-agent loggen; sonst reicht der op-auto-Backbone.
- **Pendente Exoscale-Linde-Rechnung** + **Hetzner „Archivieren fehlgeschlagen"** (aus dem Operator-Gespräch) — noch nicht abgearbeitet. Der Operator kann Linde jetzt ablegen; Hetzner-Archiv-Fehler wirkt transient (o365-cli), prüfen.
- **Head-Agent-Labels:** die cockpit_agents-Zeilen haben in der DB noch `label:"CEO"` → Org-Chart-Karte zeigt „CEO", Prompt sagt „Operator". Kleiner Rename-Rest (Anzeige-Inkonsistenz).
- **claude-log/zsh-config nicht versioniert** (wie gmail-cli vorher) — evtl. eigenes dotfiles-Repo.
- **gcal-cli** (privat-Kalender, CalDAV) — Objective, nicht gebaut. **Reiseplaner** — Objective.
- **Cockpit-Queue-Durabilität** (in-memory→SQLite) — durch SSE-404-Fallback entschärft, aber offen.
- **#939** injectionScore — **gemerged** (nicht mehr offen).

## Recall-Pointer (Memory-Files)
- `operator-per-company-context.md` — die zentrale Architektur-Lektion (Policy/Tooling/Config-Trennung, Skill-Bibliothek, Isolations-Restschwäche).
- `cockpit-operator-rename.md` — Operator-Rename + Naming-Entscheidungen.
- `troop-memory-skills-plan.md`, `openape-ci-forgejo.md`, `deltamind-openape-team.md`, `zaz-service-agent-setup.md`.
- Pläne dieser Session: `.claude/plans/2026-07-16-skill-library.md`, `2026-07-16-agent-activity-logging.md`.
