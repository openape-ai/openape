---
id: coder-story-board
status: documented
app: openape-coder
issue: 585
tests:
  - apps/openape-coder/tests/coder-story-board.test.ts
guide: story-board
---

> Endpoint-Grün (2026-06-11, Etappe 2/4): alle App-Tests dieser Story sind
> grün — Board- und Story-Lese-Endpoints sind Member-Basisrecht (keine
> Extra-Freischaltung), Nicht-Mitglied → einheitliches 404, projekt-scoped.
> Status bleibt bewusst `red`: green erst mit Board-UI + Story-Kit-Guide
> (Etappe 3).

# Die Stories eines Projekts auf einen Blick

Als Projektbeteiligter möchte ich alle User-Stories eines Projekts mit ihrem
Status auf einen Blick sehen (gruppiert oder filterbar) und eine Story öffnen
können, um alles Entscheidungsrelevante lesbar aufbereitet zu lesen (Story,
Kriterien, Repos, Links, Test-Referenzen, Status), damit ich den Stand des
Projekts erfasse, ohne Dateien oder Code zu öffnen.

## Akzeptanzkriterien

1. WENN ein Projektmitglied das Story-Board öffnet, DANN MUSS es alle Stories
   des Projekts mit Titel und Status auf einen Blick sehen.
2. WENN das Mitglied nach Status gruppiert oder filtert, DANN MÜSSEN genau die
   passenden Stories erscheinen und keine Story des Projekts verloren gehen
   (alle Gruppen zusammen ergeben den Gesamtbestand).
3. WENN ein Mitglied eine Story öffnet, DANN MUSS es alle erfassten
   Bestandteile lesbar aufbereitet sehen (Story-Satz, Akzeptanzkriterien und —
   falls vorhanden — Repos, Links, Test-Referenzen, Status), ohne Dateien oder
   Code öffnen zu müssen.
4. Das Lesen von Board und Stories MUSS jedem Projektmitglied ohne weitere
   Freischaltung möglich sein. *(v1-Lesart „Lesen ist Basis-Recht", zur
   Bestätigung)*
5. Das Board DARF NICHT Stories anderer Projekte zeigen und DARF NICHT für
   Nicht-Mitglieder zugänglich sein.

## Abhängigkeiten

- Klären: ist Lesen der Stories Basis-Recht jedes Members oder selbst eine
  pro Member schaltbare Berechtigung (Permission-Granularität,
  siehe `coder-invite-members`)
- Abhängig von `coder-user-stories` (Datenmodell inkl. Status-Werte für
  Gruppierung/Filter)
