# troop provider-agnostisch: ein Rollen-Modell + Provider-Bindung

**Goal:** troop besitzt das Org-Design (Firma + Rollen/Hierarchie + Ziele), NICHT die
Ausführung. Eine Firma ist an genau einen **Provider** gebunden (die „Agent-Providing-
Entity": Session-Loop / Nest / Codex), der die Agents laufen lässt. Der „lokal vs Nest"-
Split verschwindet aus Modell und UI. Man definiert eine Firma und redet mit ihrem CEO;
wie die Rollen ausgeführt werden, ist Sache des Providers.

**Architektur:**
- **Control-Plane (troop):** Firma (Vision/Ziele/Budget), EIN provider-agnostisches
  Rollen-Modell (Name, Persona/Aufgabe, Werkzeuge=Command-Muster, Vorgesetzter),
  Provider-Bindung, CEO-Chat.
- **Provider (pluggbar):** konsumiert die Org-Definition + führt Rollen aus. Session-Loop
  (heute) pollt die owner-gebundene Queue + delegiert an Rollen/Werkzeuge. Nest = ein
  weiterer Provider (spawnt ape-agents aus den Rollen) — pausiert, daher hinter den
  Kulissen. Das macht uns wieder Nest-kompatibel: Nest ist ein Provider, kein Sonderfall.

## Global Constraints
- Nest-Flotte bleibt pausiert → Nest-Provider-Ausführung NICHT verdrahten, nur das Modell
  vorbereiten. Nest-Spawn-Endpunkte werden Legacy (bleiben, nicht mehr primär im UI).
- @nuxt/ui/Tailwind (zinc) im Haupt-UI. main branch-protected → PR + grüne CI.
- Owner-Bindung + apes-Identität unverändert. Commit-Author Patrick, kein AI-Co-Author.

---

## M1 — Provider-Bindung auf der Firma
**Files:**
- Modify `server/database/schema.ts` + `server/plugins/02.database.ts` — organizations bekommt
  `provider TEXT` (JSON `{type:'session'|'nest'|'codex', ref?:string}`, Default `{"type":"session"}`),
  via `ALTER TABLE ... ADD COLUMN` (idempotent, try/catch am Boot).
- Modify `server/api/orgs/[id].get.ts` + `[id].patch.ts` — provider lesen/schreiben.
- Modify `app/pages/companies/[id].vue` — im „Firma bearbeiten"-Modal ein „Betrieben von"-
  Select (Session-Loop · Nest · Codex). Anzeige des Providers im Header.
**Acceptance:** Firma zeigt + editiert ihren Provider; Default „Session-Loop".

## M2 — Ein provider-agnostisches Rollen-Modell (Migration)
**Files:**
- `cockpit_agents` wird DAS Rollen-Modell der Firma (konzeptionell „org roles"): Felder
  bleiben (role, label, duties, tools[], reportsTo, enabled) — schon provider-agnostisch.
- Boot-Migration `server/plugins/03.migrate-members-to-roles.ts` (idempotent): für jede
  `org_members`-Zeile ohne entsprechende Rolle eine Rolle anlegen (role, label=agentName,
  duties aus Persona-Katalog-Summary, reportsTo = gemappte Parent-Rollen-id). CEO wird
  Rolle 0. `org_members` bleibt als Nest-Provider-Detail (Spawn-Status), nicht mehr kanonisch.
- Modify `server/utils/cockpit/system-prompt.ts` — nutzt die CEO-Rolle (Persona/Aufgabe)
  als CEO-Grundierung, wenn vorhanden; sonst der generische CEO-Prompt.
**Acceptance:** Delta Mind zeigt CEO + email-assistant + Mail-Beauftragter als EINE
Rollen-Liste mit Hierarchie; der CEO-Chat ist unverändert geerdet.

## M3 — UI vereinheitlichen (ein Org-Chart, kein lokal/Nest)
**Files:**
- Modify `app/components/company/Chart.vue` — rendert die Rollen-Hierarchie einheitlich
  (kein „lokal/Nest"-Badge, keine „kein Nest"-Sektion). Nodes = Rollen; Werkzeug-Chips;
  editier-/löschbar; „berichtet an" bleibt.
- Modify `app/pages/companies/[id].vue` — EIN „Rolle hinzufügen" (das bestehende Formular);
  die Nest-Spawn-Buttons/Modal raus aus dem primären Flow (Provider-intern).
**Acceptance:** Firmen-Ansicht = ein kohärenter Org-Chart; Rolle anlegen über EIN Formular;
keine Backing-Unterscheidung mehr sichtbar. Chat zum CEO unverändert.

---

## Bewusst NICHT in diesem Plan
- Nest-Provider real ausführen (Flotte pausiert) — nur Modell vorbereiten.
- Codex-Provider verdrahten — nur als Option im Select.
- Werkzeuge auf free-idp-Grant-Modell migrieren (eigene spätere Stufe, [[project_cockpit_orchestrator]]).
