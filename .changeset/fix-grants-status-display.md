---
'@openape/apes': patch
---

fix(apes): `apes grants status` zeigt wieder die richtigen Felder

Drei pre-existing Display-Bugs in `apes grants status <id>`:

1. **`Requester: undefined`** — das Kommando las `grant.requester`, aber die IdP-Response hat `requester` unter dem verschachtelten `request`-Objekt (`grant.request.requester`). Fix: lese aus der richtigen Stelle; wenn leer, wird die Zeile übersprungen statt `undefined` zu drucken.

2. **`Owner: undefined`** — ein `owner`-Feld existiert überhaupt nicht auf dem `GET /grants/<id>` Endpoint. War ein Holdover aus einem früheren API-Shape. Komplett entfernt.

3. **`Type: null`** — ein top-level `type`-Feld ist auf dem aktuellen IdP immer `null`. Die Zeile wird nicht mehr gedruckt.

4. **`Decided at: 1776154298`** — Timestamps kamen als Unix-Sekunden (Zahl), wurden aber als Strings gedruckt (Rohzahl auf dem Terminal). Alle Zeitstempel (`created_at`, `decided_at`, `used_at`, `expires_at`) werden jetzt als ISO-8601 formatiert via `new Date(ts * 1000).toISOString()`.

Als Bonus zeigt der Output jetzt zwei neue Felder die für den Debugging-Usecase nützlich sind und vorher fehlten:

- **`Audience:`** — zeigt ob es ein `shapes` / `escapes` / `ape-shell` Grant ist (wichtig seit der Introduction des `apes grants run <id>` Subcommands in 0.9.0, der nach Audience dispatcht)
- **`Host:`** — zeigt den `target_host`, wichtig für Session-Grants die host-gebunden sind

Sowie:

- **`Used at:`** — neu, zeigt wann ein once-Grant consumed wurde (nützlich um zu unterscheiden ob ein Grant `used` ist weil der User ihn ausgeführt hat oder weil er geblendet wurde)
- **`Created:`** — neu, der Creation-Timestamp war vorher nicht sichtbar

Keine Änderung an `apes grants status --json` — das dumped weiterhin die rohe API-Response unverändert.
