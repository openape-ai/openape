---
"@openape/apes": patch
---

Keine „Grant wartet auf Freigabe"-Benachrichtigung mehr für Grants, die der IdP
bei der Erstellung selbst freigegeben hat (Standing Grant, YOLO). Die neue
`isAutoApproved`-Prüfung sitzt an allen vier Aufrufstellen; im ape-shell-Pfad
entfällt damit auch die irreführende „Approve at: …"-Zeile. Ein echter pending
Grant benachrichtigt unverändert.
