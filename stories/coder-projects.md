---
id: coder-projects
status: documented
app: openape-coder
issue: 585
tests:
  - apps/openape-coder/tests/coder-projects.test.ts
guide: create-project
---

> Red-Beweis (2026-06-11): 7 Tests (Kriterien 1-5; Store-Ebene gegen
> In-Memory-SQLite + Endpoint-Ebene) in
> `apps/openape-coder/tests/coder-projects.test.ts` failen am fehlenden
> Verhalten — `ensureCoderSchema`/`createProjectStore` werfen „not
> implemented", die Routen-Stubs antworten 501. Skelett baut, Lint +
> Typecheck grün. Der UI-Flow (Projekt-Dialog, Vision/Repos-Pflege) wird
> in der green-Phase als eigener Schritt zur Story-Kit-Story (Guide),
> wie beim #462-Muster.

> Endpoint-Grün (2026-06-11, Etappe 2/4): alle App-Tests dieser Story sind
> grün — die Projekt-Endpoints (Liste/anlegen/Detail/Scope-Patch) sind
> verdrahtet, Scope-Edit per `canEditScope`-Gate (admin-implizit oder
> `editScope`-Grant). Status bleibt bewusst `red`: green erst mit UI-Flow +
> Story-Kit-Guide (Etappe 3).

> Verfeinerung (2026-06-12): betroffene Repos werden als **vollständige URL**
> geführt (Kriterium 6), nicht als `owner/repo` — ein Projekt kann Repos auf
> GitHub, GitLab, Forgejo oder self-hosted referenzieren, und nur die URL ist
> über Forges hinweg eindeutig. Die App rendert sie als anklickbare Links.

# Projekte anlegen und pflegen

Als Nutzer möchte ich meine Projekte in einer Übersicht sehen und neue Projekte
anlegen (deren Admin ich dann bin), und als Admin möchte ich pro Projekt die
**Vision** (was das Vorhaben ist und was nicht) und die Liste der **betroffenen
Repos** (jeweils als URL, forge-unabhängig) pflegen, damit jedes Projekt seinen
Rahmen — Zweck und Code-Orte — an einem Platz trägt und alle Beteiligten
denselben Kontext sehen.

## Akzeptanzkriterien

1. WENN ein angemeldeter Nutzer ein neues Projekt mit einem Namen anlegt,
   DANN MUSS das Projekt in seiner Übersicht erscheinen und der Anleger
   dessen Admin sein.
2. Ein Projekt MUSS auch ohne Vision-Text und ohne betroffene Repos anlegbar
   sein; beides MUSS nachträglich gepflegt werden können.
3. WENN ein Admin die Vision oder die Liste der betroffenen Repos ändert,
   DANN MÜSSEN alle Projektmitglieder beim nächsten Aufruf den neuen Stand
   sehen.
4. WENN ein Nutzer seine Projektübersicht öffnet, DANN MUSS er genau die
   Projekte sehen, in denen er Mitglied (Admin oder Member) ist — keine
   anderen.
5. Ein Member ohne entsprechende Freischaltung DARF NICHT Vision oder
   Repo-Liste ändern können; der Versuch MUSS sichtbar abgelehnt werden.
6. Jeder Eintrag in der Repo-Liste MUSS eine vollständige `http(s)`-URL sein
   (forge-unabhängig: GitHub, GitLab, Forgejo, self-hosted); ein Eintrag, der
   keine gültige URL ist, MUSS sichtbar abgelehnt werden, und gespeicherte
   Repos MÜSSEN als anklickbare Links dargestellt werden.

## Abhängigkeiten

- DB-Schema: Projekte (Vision-Text, Liste betroffener Repo-URLs) + Mitgliedschaften
  mit Rolle Admin/Member
- Abhängig von `coder-sign-in` (App-Grundgerüst, Auth)
