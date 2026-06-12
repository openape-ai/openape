---
id: coder-cli
status: green
app: openape-coder
issue: 585
tests:
  - packages/ape-coder/test/coder-cli.test.ts
guide: null  # CLI — no UI guide; a `ape-coder docs`/terminal guide may be added in green
---

# Alles auch per CLI

Als Entwickler möchte ich Projekte und Stories auch über das CLI `ape-coder`
bedienen (`ape-coder projects list`, Stories auflisten/lesen/ändern — mit
denselben Berechtigungen wie in der App), angemeldet über das einmalige
`apes login` meines Geräts, damit ich beim Arbeiten im Terminal bleiben kann
und Skripte/Agents auf den lesenden Teilen aufsetzen können.

## Akzeptanzkriterien

1. WENN ein Nutzer auf seinem Gerät einmal `apes login` durchgeführt hat,
   DANN MÜSSEN `ape-coder`-Befehle ohne weiteren Login funktionieren.
2. WENN ein Nutzer `ape-coder projects list` ausführt, DANN MUSS die Ausgabe
   genau die Projekte enthalten, die er auch in der App sieht.
3. WENN ein Nutzer per CLI Stories auflistet, liest oder ändert, DANN MUSS
   dasselbe Berechtigungs-Ergebnis gelten wie in der App: was dort verboten
   ist, MUSS auch per CLI mit verständlicher Meldung abgelehnt werden.
4. Das CLI DARF NICHT Sonderrechte besitzen; insbesondere DARF ein
   Agent-Token auch per CLI NICHT einladen oder Berechtigungen ändern können.
5. WENN keine gültige Anmeldung vorliegt, DANN MUSS das CLI auf `apes login`
   verweisen, statt Funktionen ohne Anmeldung anzubieten.
6. Lesende Befehle MÜSSEN eine maschinenlesbare Ausgabe anbieten, damit
   Skripte und Agents darauf aufsetzen können.

## Abhängigkeiten

- Neues CLI-Package `@openape/ape-coder` (Muster ape-plans/ape-tasks),
  Auth via `@openape/cli-auth` (liest `~/.config/apes/auth.json`)
- Token-Exchange-Endpoint `POST /api/cli/exchange` (RFC 8693) auf
  coder.openape.ai (Muster plans/tasks)
- API-Endpoints der App, die dasselbe Permission-Modell durchsetzen wie die
  Web-UI (keine CLI-Sonderrechte)
