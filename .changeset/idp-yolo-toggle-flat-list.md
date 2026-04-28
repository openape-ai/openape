---
"openape-free-idp": patch
---

idp: YOLO ist ein Toggle, die Liste interpretiert sich davon

UI-Modell-Korrektur: vorher hatte die Card einen "YOLO konfigurieren"-Button und
einen separaten Mode-Select (Allow-Liste / Deny-Liste). Konzeptuell stimmt das
nicht — YOLO und Mode sind dieselbe Achse:

- **YOLO an** = default allow → die Liste filtert (Deny-Patterns)
- **YOLO aus** = default deny → die Liste lässt durch (Allow-Patterns)

Card rendert jetzt:
- Switch "YOLO-Modus" oben mit Erklärung welcher Listen-Sinn aktiv ist
- Pattern-Liste **immer sichtbar**, Label adapts: "Deny-Patterns" wenn YOLO an,
  "Allow-Patterns" wenn YOLO aus
- Empty-State-Hint je nach Mode ("YOLO approved jeden Request" / "Jeder Request
  wartet auf manuelle Bestätigung")
- "Zurücksetzen" löscht die Policy-Row komplett (= default deny ohne Allow-Liste)
- Edit/View-Trennung entfernt — Form ist immer einsehbar/editierbar

Datenmodell unverändert (`mode: 'deny-list' | 'allow-list'`). Storage-Mapping:
`yoloOn=true ↔ mode='deny-list'`, `yoloOn=false ↔ mode='allow-list'`.
