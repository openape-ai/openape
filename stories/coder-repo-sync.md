---
id: coder-repo-sync
status: green
app: openape-coder
issue: 585
tests:
  - packages/ape-coder/test/coder-repo-sync.test.ts
guide: null  # CLI — no UI guide; a terminal sync walkthrough may be added in green
---

# Ein Repo per Config an ein Projekt binden und syncen

Als Entwickler möchte ich in meinem Repo eine `.ape-coder/config` hinterlegen,
die es an ein Projekt bindet, und optional Story-Dateien dort halten, sodass
`ape-coder sync` client-seitig zwischen Repo und Service abgleicht — beide
Richtungen, Konflikte laut mit beiden Ständen statt stillem Überschreiben —,
damit Repo-Arbeit und Cloud-Übersicht derselbe Kanon bleiben, ohne dass der
Service jemals mein Repo kennt oder erreicht.

## Akzeptanzkriterien

1. WENN ein Repo per `.ape-coder/config` an ein Projekt gebunden ist und der
   Nutzer `ape-coder sync` ausführt, DANN MUSS der Abgleich in beide
   Richtungen erfolgen: neue oder geänderte Stories der einen Seite erscheinen
   danach auf der anderen.
2. WENN dieselbe Story seit dem letzten Abgleich auf beiden Seiten geändert
   wurde, DANN MUSS der Sync den Konflikt melden und beide Stände zeigen; er
   DARF NICHT einen der beiden Stände still überschreiben.
3. WENN ein Konflikt gemeldet wurde, DANN MUSS der Nutzer pro Story
   entscheiden, welcher Stand gilt — der Sync DARF NICHT automatisch
   auflösen.
4. Der Sync MUSS vollständig vom CLI ausgehen; der Service DARF NICHT
   Repo-Adresse, Repo-Inhalte jenseits der Story-Daten oder Zugangsdaten zum
   Repo erhalten oder speichern.
5. WENN der Nutzer im gebundenen Projekt keine Schreib-Freischaltung hat,
   DANN MUSS der Sync Änderungen in Richtung Service ablehnen und das klar
   melden; das Holen des Service-Stands ins Repo bleibt möglich.
6. WENN keine oder eine ungültige Projekt-Bindung vorliegt, DANN MUSS
   `ape-coder sync` mit einer verständlichen Meldung abbrechen, statt ein
   Ziel zu raten.

## Abhängigkeiten

- Schema für `.ape-coder/config` (Projekt-Bindung) und Format der optionalen
  Story-Dateien im Repo (Frontmatter-Felder ↔ Service-Datenmodell)
- Konflikt-Erkennung + -Darstellung (beide Stände zeigen, nie still
  überschreiben — Vision: „Sync-Konflikte sind laut statt still")
- Abhängig von `coder-cli` (Sync läuft als CLI-Befehl) und
  `coder-user-stories` (Story-Datenmodell)
