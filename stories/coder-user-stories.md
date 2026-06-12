---
id: coder-user-stories
status: documented
app: openape-coder
issue: 585
tests:
  - apps/openape-coder/tests/coder-user-stories.test.ts
guide: add-story
---

> Endpoint-Grün (2026-06-11, Etappe 2/4): alle App-Tests dieser Story sind
> grün — Story-Write-Endpoints (anlegen/bearbeiten/Status) hinter dem
> `writeStories`-Gate (`hasCapability`), Member ohne Grant → 403, nichts
> ändert sich. Status bleibt bewusst `red`: green erst mit UI-Flow +
> Story-Kit-Guide (Etappe 3).

# User-Stories im Projekt anlegen und pflegen

Als Projektbeteiligter (mit entsprechender Berechtigung) möchte ich
User-Stories im Projekt anlegen und bearbeiten — mit den üblichen
Bestandteilen (Titel, „Als … möchte ich …, damit …", Akzeptanzkriterien) und
optional Repos, Links, Test-Referenzen und einem Status —, damit Anforderungen
dort entstehen und reifen, wo alle Beteiligten sie sehen, statt in Mails oder
verstreuten Dokumenten.

## Akzeptanzkriterien

1. WENN ein Berechtigter im Projekt eine neue Story mit Titel und Story-Satz
   („Als … möchte ich …, damit …") anlegt, DANN MUSS sie im Projekt erscheinen
   und für alle Mitglieder lesbar sein.
2. Eine Story MUSS auch ohne die optionalen Angaben (Repos, Links,
   Test-Referenzen, Status) anlegbar sein; die optionalen Angaben MÜSSEN
   nachträglich ergänzbar sein. Repos und Links MÜSSEN, wenn angegeben,
   vollständige `http(s)`-URLs sein (forge-unabhängig) und als anklickbare
   Links dargestellt werden; ungültige Einträge MÜSSEN abgelehnt werden.
3. WENN ein Berechtigter eine Story bearbeitet (Bestandteile oder optionale
   Felder), DANN MUSS der neue Stand für alle Mitglieder sichtbar sein.
4. WENN der Status einer Story geändert wird, DANN MUSS nachvollziehbar sein,
   wer ihn wann geändert hat.
5. Ein Member ohne Schreib-Freischaltung DARF NICHT Stories anlegen oder
   ändern können; der Versuch MUSS sichtbar abgelehnt werden.
6. Eine Story DARF NICHT außerhalb ihres Projekts sichtbar sein — sie gehört
   genau einem Projekt und ist nur dessen Mitgliedern zugänglich.

## Abhängigkeiten

- Story-Datenmodell: Pflichtfelder (Titel, Story-Satz, Akzeptanzkriterien) +
  optionale Felder (Repos, Links, Test-Referenzen, Status) inkl. Status-Werte-Set
- Permission-Granularität: Anlegen/Bearbeiten als pro Member schaltbare
  Funktion (siehe `coder-invite-members`)
- Abhängig von `coder-projects` (Stories hängen an einem Projekt)
