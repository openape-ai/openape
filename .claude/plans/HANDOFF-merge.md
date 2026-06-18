# Handoff-Prompt — Troop+Org-Merge (frische Session)

Paste den folgenden Block als erste Nachricht in die neue Session.

---

Du bist mein **gutes Gewissen / Agent-Troop-Supervisor** für OpenApe (ich = Patrick, Owner).
Du steuerst + gatest; die Agents machen die Arbeit. Nachrichten an mich mit Uhrzeit beenden.

**ZUERST LESEN (nichts ist verloren):** dein Memory lädt automatisch (MEMORY.md + project_*/reference_*).
Lies zusätzlich `openape-monorepo/.claude/plans/werkstatt-roadmap.md`. Da steht der volle Stand.
Die autonomen Loops laufen im Nest-Container `openape-nest` (auf meinem Mac) WEITER — unabhängig von
der Session. Du übernimmst nur die Supervisor-Rolle.

**HAUPTAUFGABE — frisch starten: Troop + Org zusammenlegen (B0).**
Gestufter Merge: (1) Daten verknüpfen → (2) Deployables → (3) ein UI. Warum jetzt: er macht den
Kommunikations-Loop Owner↔CEO↔Assistenten in EINEM UI klar (CEO-Chat = Troop-Fähigkeit, Reports/Org =
Org-Fähigkeit; heute getrennt) und behebt die 4-fach verstreute Agent-Identität
(IdP / troop `agents` / org `org_members` / tasks `team_members`, nur per E-Mail-String verbunden).
- **Stufe 1 = org_members↔troop-agents↔tasks-Team verknüpfen** (FK statt String; löst org_id≠team_id).
- Troops **Maschinen-Surface MUSS byte-stabil bleiben**: `/api/agents/me/*`, Nest-WS, `/api/nests/token`,
  `spawn-intent`, `cli/exchange`-Scopes (CLI + Nests hängen dran). Org hat KEINE externen Konsumenten
  → safe to restructure. Richtung: Org wandert in den Troop-Backend.
- Plane es sauber als eigenen Plan in `.claude/plans/` BEVOR du Code anfasst. Mach ggf. eine frische
  Explore über die Merge-Surface (org+troop apps, packages/apes, openape-nest, openape-tasks).

**LÄUFT AUTONOM — NICHT KAPUTT MACHEN:**
- **Werkstatt:** PM-orchestrator `pm-orchestrator` (recipe v0.5.1, gpt-5.5/high, JEDE MINUTE, ASSIGN-Treiber)
  triagiert Team `01KV0XTPETENZ42S5GE6GRPGDG` (Org `38f8e8e9-eec5-440c-b716-6c0f8224270c`) + weist
  backend/scribe/qa zu via `ape-tasks edit --assignee`. Die self-coden auf Forgejo
  `patrick/werkstatt-sandbox` mit eigenen Identitäten `werkstatt-backend/qa/scribe` (Schedule */2).
  Details: [[project_pm_orchestrator_v2]], [[reference_werkstatt_bot_forge]].
- **Delta Mind** (Org `5fa4cb85-bdba-440d-bc78-477ce6afe11e`): CEO `dm-ceo` (ceo@v0.6.0, wöchentlich Mo 8h)
  → Email-Assistent (email-assistant@v0.4.1, alle 4h, triagiert phofmann@delta-mind.at via o365-cli →
  Tasks im Delta-Mind-Team `01KV5FZ7RQYGJ1GTJYTYSCB46A`). Details: [[project_delta_mind]].
- **Opus-launchd-Motor bleibt AUS** (com.openape.werkstatt-* — verursachte den Deadlock).

**LAUFENDE SUPERVISOR-PFLICHTEN (das „Überwachen"):**
- Periodisch die Forgejo-Sandbox-PRs der Agents gaten: Ehrlichkeit prüfen (Doku == Code? kein Fake),
  saubere squash-mergen, zweifelhafte an mich eskalieren. Forgejo-Admin-Token:
  `printf "protocol=https\nhost=git.openape.ai\n\n" | git -C openape-monorepo credential fill` → password.
- PM-Eskalationen (Owner-Entscheidungen) gebündelt an mich.
- IdP/Nest stabil halten (429-Fix live = getrennte Buckets + 8h-Token, [[reference_idp_rate_limit]];
  Nest-Auth Auto-Refresh, [[reference_nest_auth_reauth]]).
- Wenn ich will, dass das Gaten/Überwachen OHNE mich periodisch läuft: schlag mir einen Supervisor-Cron
  vor (CronCreate/Monitor) der eine Claude-Supervisor-Runde anstößt — Cadence + Scope mit mir klären.

**OFFEN (nach/neben dem Merge):**
- Buchhaltungs-Assistent (Delta Mind Produkt 2) — braucht eigenen o365-cli-Device-Login von mir.
- „CEO informiert mich über die Email-Triage" verdrahten (CEO-Prompt; unabhängig vom Merge möglich).
- Prüfen, dass die 2 PRs `fix/idp-rate-limit-agent-bucket` (#752) + `fix/pm-agent-spawn-owner` (#753)
  gemerged sind (waren Auto-Merge-armed).
- Recipe-Drift: PM/email/worker-Recipes leben im lokalen Repo `~/Companies/private/repos/openape/
  agent-catalog` (Tags …v0.6.0) mit GitHub-Mirror; nach Edits committen+taggen+pushen.

Leg los: Memory + Roadmap lesen, kurz den Live-Stand verifizieren (nichts gestrandet), dann den
Merge planen.
