> **Status 2026-07-09: M1+M2+M3 LIVE (PR #918, prod-6c070de6).**

# Rollen/Personas in die troop-Hierarchie + Chat in die Nav

**Goal:** Rollen/Werkzeuge werden im troop-Control-Plane (Company-Hierarchie) verwaltet,
nicht im Chat-Drawer. Der Header schaltet Firmen/Nests/**Chat**. Nest-lose Agenten
(`cockpit_agents`) sind erst-klassige Mitglieder in der Hierarchie neben Nest-Agenten.

**Entscheid:** Zwei Backings, eine Hierarchie. `cockpit_agents` bleibt eigene Tabelle
(nest-los); `orgMembers` bleibt (nest-backed, Recipe-Spawn). Die Company-Hierarchie
zeigt + editiert BEIDE, unterschieden per Badge. Kein Eingriff in die Nest-Spawn-Logik.

## Global Constraints
- @nuxt/ui + Tailwind (zinc) im troop-Haupt-UI; Cockpit-CSS nur im /chat.
- cockpit_agents CRUD existiert (`/api/cockpit/orgs/:id/agents`) → wiederverwenden.
- main branch-protected → PR + grüne CI. Commit-Author Patrick, kein AI-Co-Author.

---

## M1 ✅ — Chat als dritte Ansicht in der Nav
**Files:**
- Modify: `apps/openape-troop/app/components/ViewToggle.vue` — dritter Button „Chat" → `/chat`
  (prop `active` erweitern: 'companies' | 'nests' | 'chat').
- Modify: `apps/openape-troop/app/components/cockpit/CockpitChat.vue` — im Cockpit-Header ein
  Zurück-/Umschalter zu `/companies` (Symmetrie; der Chat ist layout:false).
**Acceptance:** Von `/companies` per Header nach `/chat` und zurück; aktiver Zustand korrekt.

## M2 ✅ — Nest-lose Agenten in der Company-Hierarchie
**Files:**
- Modify: `apps/openape-troop/app/pages/companies/[id].vue` — zusätzlich zu `/api/orgs/:id/members`
  auch `/api/cockpit/orgs/:id/agents` laden; beide zu einem Baum normalisieren
  (`{ key, name, role, reportsTo, backing: 'nest'|'local', tools }`). „Rolle hinzufügen" bekommt
  eine Variante „lokal (kein Nest)" → POST cockpit_agents (Label/Rolle/Aufgabe/Tools).
- Modify: `apps/openape-troop/app/components/company/ChartNode.vue` — Badge „lokal"/„Nest",
  Tools-Chips für lokale Knoten; lokale Knoten inline editier-/löschbar (PATCH/DELETE cockpit_agents).
- Nest-lose Blätter hängen per `reportsTo = <CEO agentEmail>` unter dem CEO im selben Baum.
**Acceptance:** In der Company-Ansicht eine lokale Rolle mit Tool anlegen → erscheint im Chart mit
„lokal"-Badge; im nächsten Cockpit-Turn delegiert der CEO daran (unverändert aus M0/M1).

## M3 ✅ — Chat-Drawer entkernen
**Files:**
- Modify: `apps/openape-troop/app/components/cockpit/CockpitChat.vue` — 👥-Team-Drawer entfernen;
  stattdessen (optional) ein kleiner Link „Team in troop verwalten" → `/companies/<id>`.
- Delete: `apps/openape-troop/app/components/cockpit/CockpitTeam.vue` +
  `app/composables/useCockpitTeam.ts` (in die Company-Ansicht gewandert).
**Acceptance:** Kein 👥 mehr im Chat; Team nur noch im Control-Plane editierbar; Chat konsumiert nur.

---

## Nest-Ansicht (Notiz, nicht in diesem Plan)
Nests-Ansicht bleibt geräte-fokussiert (physische Nests + darauf laufende ape-agents).
Nest-lose Agenten erscheinen dort NICHT (sie haben kein Gerät) — nur in der Company-Hierarchie.
Später denkbar: eine „lokale Agenten"-Übersicht, falls die Zahl wächst. YAGNI bis dahin.
