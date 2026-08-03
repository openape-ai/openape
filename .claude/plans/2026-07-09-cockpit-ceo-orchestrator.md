> **Status 2026-07-09: M0+M2 deployed (prod-c4695cfe), M1 E2E bewiesen. Offen: Loop-Restart für neuen Delegations-Skill.**

# Cockpit-CEO als Orchestrator (Option B, troop-kanonisch)

**Goal:** Der Cockpit-CEO wird handlungsfähig: geerdet in seinem troop-definierten
Org-Baum delegiert er tool-pflichtige Aufgaben an Blatt-Subagents, die lokal unter
Patricks Identität laufen (human-in-the-loop). Erster Pfad: Email auf Delta Mind.

**Architektur (der Schlüssel):** Das „Gehirn" ist die `/loop /troop-cockpit-ceo`-
Session, nicht der troop-Server. Der Server (`message.post`) reicht Task + Grundierung
durch; das Reasoning UND die neue Delegation passieren in der Session, wenn sie den
Task via `cockpit-agent.sh next` zieht. troop = kanonische Quelle des Org-Baums
(`orgMembers`: role/persona/reportsToEmail; `agents.tools`), online im Cockpit
sichtbar/editierbar. `~/ape-companies` wird optional daraus generiert (nicht kanonisch).

Zwei Stücke:
1. **Baum → CEO-Grundierung:** troop liefert den Org-Baum (Mitglieder, Personas,
   Tools) in die Cockpit-Task-Daten. Der CEO *kennt* sein Team + wer welches Tool hat.
2. **Lokaler Executor (Kern von B):** die Session spawnt für ein tool-pflichtiges
   Anliegen ein Blatt als Claude-Subagent mit dessen Persona + Tool (`o365-cli`),
   read-only unter Patricks Identität, bündelt das Ergebnis in die CEO-Antwort.

## Global Constraints
- troop = kanonisch; kein Nest anfassen (Werkstatt bleibt pausiert); apes-Identität.
- Human-in-the-Loop: nach außen wirkende Aktionen NIE still — nur lesen + vorschlagen
  (die Mail-Persona ist bereits read-only: „beantwortet NIE, verschiebt/löscht nichts").
- Kein Mock; die „working"-Presence deckt die längere Subagent-Laufzeit ab.
- Commit-Author Patrick, kein AI-Co-Author. main branch-protected → PR + grüne CI.

---

## M0 ✅ — troop hält + liefert den Org-Baum an den CEO

**Files:**
- Modify: `apps/openape-troop/server/api/cockpit/companies.get.ts` — pro Firma den
  Org-Baum mitliefern (members: {agentEmail, role, persona, reportsToEmail, tools}).
- Modify: `apps/openape-troop/server/api/cockpit/message.post.ts` —
  `buildSystemPrompt` erweitert um den Baum: „Dein Team: <rolle: persona, tools>…
  Für tool-pflichtige Aufgaben delegierst du an das Blatt mit dem passenden Tool."
- Data: Delta-Mind-`orgMembers` auf troop anreichern, sodass der Baum den lokalen
  spiegelt (mind. Mail-Specialist mit `tools:[o365-cli]` + Persona). Via
  `POST /api/orgs/<id>/members` bzw. `PATCH`.
- Test: `apps/openape-troop/tests/cockpit-org.test.ts` — buildSystemPrompt enthält
  Team + Tool-Hinweis, wenn Members übergeben werden.

**Acceptance:** `curl /api/cockpit/companies` (owner-token) liefert für Delta Mind
den member-Baum inkl. Mail-Specialist + `o365-cli`. Ein Cockpit-Task-`systemPrompt`
(geloggt) enthält „Mail-Beauftragter … tools: o365-cli".

## M1 ✅ — Email-Pfad E2E: CEO delegiert an Mail-Subagent

**Files:**
- Modify: `~/.claude/skills/troop-cockpit-ceo/SKILL.md` — neuer Abschnitt „Delegation":
  Erfordert das Anliegen ein Tool, das ein Team-Blatt hat, **spawne einen Subagent**
  (Agent-Tool) mit dessen Persona-Prompt + Auftrag, das Tool read-only zu fahren
  (`o365-cli mail list --account phofmann@delta-mind.at --json`), Ergebnis strukturiert
  zurück. Dann antworte als CEO, geerdet in dessen Meldung. Nach außen → nur vorschlagen.
- Precondition-Check im Skill: `o365-cli --help` erreichbar + eingeloggt.

**Acceptance (beobachtbar):** Im Cockpit (troop.openape.ai/chat, Delta Mind)
„hast du meine letzten Mails?" → Presence zeigt „CEO arbeitet", der CEO liefert einen
**echten Triage-Digest** der Delta-Mind-Inbox (Absender/Betreff/Handlung), kein Mock,
kein „ich sehe deine Mails nicht". Screenshot + SSE-Mitschnitt als Beweis.

## M2 ✅ — Generalisieren + online editierbar

**Files:**
- Modify: `apps/openape-troop/app/pages/companies/[id].vue` (bzw. bestehende
  Hierarchie-Ansicht) — Baum anzeigen + Rolle/Persona/Tools bearbeiten (nutzt
  vorhandene `/api/orgs/[id]/members`-Endpunkte).
- Modify: SKILL.md — Delegation generisch für jedes Blatt/Tool (nicht mail-spezifisch).

**Acceptance:** Online eine neue Specialist-Rolle + Tool anlegen → der CEO delegiert
im nächsten Turn an sie. Baum in der UI editierbar, Änderung wirkt ohne Redeploy
(nächster Task zieht die frische Grundierung).

---

## Offene Punkte (vor M1 klären falls nötig)
- Subagent-Laufzeit vs. Burst-Timeout: der Spawn läuft als eigener Tool-Call; die
  Session pollt derweil nicht — „working"-Presence deckt es, Latenz ~10-60s ok.
- Tool-Zugang: `o365-cli` lokal + eingeloggt für phofmann@delta-mind.at (bereits so).
  Weitere Tools (Kalender) analog, je Blatt.
