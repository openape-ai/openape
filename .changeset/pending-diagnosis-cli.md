---
'@openape/apes': minor
---

ape-shell/`apes run` erklärt bei einem pending Grant, WARUM er wartet: der
Async-Block zieht die `pending_diagnostics` des IdP (#1109) und druckt sie mit.
Enthält das Kommando `$( )`-Substitution, Loops oder Heredocs, sagt der Block
explizit: wird NIE auto-approved — in einfache Einzelkommandos zerlegen statt
retryen. Damit kann ein konsumierender Agent im Task reagieren, statt Karte um
Karte zu produzieren.
