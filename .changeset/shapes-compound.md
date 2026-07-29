---
'@openape/shapes': minor
'@openape/apes': minor
---

Compound-Shell-Zeilen (`a | b`, `a && b`) laufen segmentweise durch die
Shapes-Auflösung: EIN Grant-Request mit den strukturierten Details aller
Segmente (Adapter wo vorhanden, Generic-Fallback sonst), Ausführung nach
Approval als Original-Zeile. Substitution, Redirects, sudo-Segmente und
gemischte Audiences fallen weiter fail-closed auf den opaken Pfad.
