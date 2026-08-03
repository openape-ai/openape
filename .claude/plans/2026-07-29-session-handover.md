# Session-Handover 2026-07-29 → Folgesession

**Kontext:** Nachtsession 28.–29.07. (Session-ID `f212b9cc-bb91-4997-aabd-92d72489c1b0`,
cwd `~/Companies/private/repos/openape/openape-monorepo`). Die drei Blöcke aus dem
Handover vom 28.07. sind abgearbeitet; danach kamen auf Patricks Zuruf zwei größere
Ausbauten dazu (Per-Company-Operatoren, Mail-/Kalender-/Repo-Betrieb). Self-contained —
die Folgesession braucht keine Vorkenntnisse aus dem Chat.

> **Nachtrag aus der Folgesession (29.07., 11:0x):** Die Ursprungssession lief beim
> Schreiben in wiederholte PreToolUse-Hook-Timeouts und konnte die beiden Screenshots
> nicht öffnen. **Sie sind inzwischen ausgewertet** — Abschnitt 2, Punkte 1 und 2 sind
> entsprechend ersetzt und enthalten Befunde, die in #1085/#1086 noch NICHT stehen.

---

## 1. Was JETZT live ist

### Identitäten (id.openape.ai) — von 36 auf 6 aufgeräumt
| Identität | Rolle |
|---|---|
| `op-worker` | **Transport** des Loops: troop-Delegation `troop:cockpit-serve` + zaz-Service-Assertion. Bewusst OHNE YOLO-Policy — darf nichts auto-approven. |
| `op-delta-mind` | Firmen-Autorität Delta Mind (`5fa4cb85-…`) |
| `op-openape` | Firmen-Autorität OpenApe (`38f8e8e9-…`) |
| `op-iurio` | Firmen-Autorität IURIO (`38d79b45-…`) |
| `op-privat` | Firmen-Autorität privat (`e4bb550a-…`) |
| `op-test` | Test-Org (`04356fbb-…`), Policy geleert |

33 Alt-Identitäten (Rollen-Personas, Nest-Ära, Service-Agents, Tests) wurden hart
gelöscht. Snapshot: `~/.config/openape-worker/agents-snapshot-2026-07-28.txt`.
Schlüssel: `~/.config/openape-worker/op-keys/` — **Backup-Task liegt in ape-tasks**.
Mapping Org→Identität: `~/.config/openape-worker/operators.json`.
Neue Firma: `~/.config/openape-worker/provision-company-operator.sh <orgId> <name>`.

### Operator-Betrieb (der praktische Teil)
- **Mail-Triage** für Delta Mind (`phofmann@delta-mind.at`, o365-cli), IURIO
  (`patrick@docpit.eu`, o365-cli), privat (`patrick@hofmann.eco`, gmail-cli).
  Eigenständig archivieren, aber **verbose**: jede Mail einzeln mit Absender+Betreff
  plus ausdrückliche Einverständnis-Frage. Verankert als Company-Memory
  „Meldeformat Mail-Triage" — auf der Rolle allein ging die Frage beim Verdichten verloren.
- **Verb-Trennung (Patricks Regel):** Rollen-`tools` nennen nur Lese-/Ablage-Verben;
  `mail send/reply/forward/trash` und schreibende Kalender-Verben brauchen seinen Grant.
  Wildcard-Orgs (IURIO, OpenApe) haben dieselben Verben zusätzlich in `YOLO_DANGEROUS`
  (worker.sh). Nachgewiesen: `mail list` = auto:yolo, `mail send` = pending.
- **Kalender** für alle drei, nur lesend (privat seit Patricks gmail-cli-Nachbesserung).
- **Zeitpläne:** Triage 07:00 + 14:00, Termin-Vorschau 18:00 — gestaffelt
  (DM :00, IURIO :20, privat :40), weil der Cockpit-Loop sequenziell arbeitet.
  Erster autonomer Lauf 29.07. 07:00 hat funktioniert.
- **IURIO-Repo-Meldungen:** troop-Hook + 4 Azure-DevOps-Service-Hooks (push,
  PR created/updated/merged) auf `iurioServer`. `az` kommt mit **leerem PAT**
  (`AZURE_DEVOPS_EXT_PAT=""`) an der gesperrten Keychain vorbei (Patricks Tipp);
  Subscriptions via REST + `az account get-access-token --resource 499b84ac-…`.

### Prod-Stände
- free-idp `prod-6b06a578`, troop `prod-4e090d25`
- npm: `@openape/apes` 1.33.3, `@openape/shapes` 0.8.0, `@openape/nuxt-auth-idp` 0.32.0
- Rate-Limit prod: `OPENAPE_RATE_LIMIT_MAX_AUTH=30` (Code-Default 10, bewusst erhöht)

---

## 2. Offene Punkte (empfohlene Reihenfolge)

1. **#1085 Cockpit-Rauschen beim OpenApe-Operator** — Screenshot `IMG_0981.PNG`
   (Cockpit-Chat OpenApe, 09:36) ausgewertet, er zeigt **drei Fehlerbilder auf einmal**:
   - **Push löst den Issue-Hook aus.** 09:16: „das war ein Push auf `main` (Merge von
     PR #1084), kein neu eröffnetes Issue. Daher keine Aktion." Der Hook heißt „Forgejo:
     neue Issues", bekommt aber Push-Events → ein voller LLM-Lauf endet in einer Meldung,
     die nur sagt, dass nichts zu tun war. Zwei Hälften: Webhook-Events in Forgejo
     einschränken (braucht Admin-Token — `~/.config/openape-worker/forgejo-token` reicht
     NICHT: `user should be an owner or a collaborator with admin write`) und troop-seitig
     ein `eventFilter` am Hook bzw. „bei Nicht-Zuständigkeit still beenden" im Prompt.
   - **„Zwischenstand"-Spam.** Mehrfach
     `Zwischenstand 🔧 APE_WAIT=1 APES_AUTH_FILE=/Users/patrickhofmann/.config/ · 255s`
     (und `· 310s`) — rohe Env-Präfixe des laufenden Kommandos als Fortschrittsmeldung an
     den Owner. Unlesbar und ohne Informationswert; unterdrücken oder auf „Operator
     arbeitet an X" verdichten.
   - **Grant-Timeout blockiert den Backlog-Check.** 09:06: „Die Forgejo-API-Abfrage
     scheiterte an der Shell-Grant-Prüfung mit `ERROR Grant approval timed out after
     5 minutes`. Daher gibt es keinen belastbaren Befund und keine Änderung." Ein
     wiederkehrender Read-only-Check wartet fünf Minuten auf einen Grant, der nie kommt →
     gehört in die YOLO-Policy des OpenApe-Operators.

   Letzte Hook-Feuerungen zur Einordnung: OpenApe/Forgejo 29.07. 09:16:26,
   IURIO/ADO 29.07. 09:25:30.
2. **#1086 Organigramm am Handy abgeschnitten** — Screenshot `IMG_0982.PNG`
   (troop.openape.ai → Firmen → Organigramm, iPhone-Viewport, 09:37) ausgewertet: Der Baum
   ist **breiter als der Viewport und wird hart abgeschnitten statt skaliert oder
   horizontal scrollbar**.
   - Owner- und Operator-Knoten zentriert und intakt.
   - Team-Lead-Ebene links angeschnitten: „…RIO Scrum Team Manager" statt „IURIO Scrum
     Team Manager", Tool-Zeile bricht als „…io * · ape-tasks * · git *" ab.
   - Specialist-Ebene beidseitig angeschnitten: links nur „…er / …LIST" lesbar, rechts
     „Visual Reviewer" am Rand abgeschnitten.
   - Tab-Zeile „Organigramm | Mitarbeiter" wird oben von der Toolbar überlappt.

   Der Baum ist auf die Owner/Operator-Achse zentriert; breitere Ebenen laufen ohne
   Overflow-Scroll nach beiden Seiten aus dem Sichtfeld. Fix: horizontal scrollbarer
   Container bzw. Fit-to-width im schmalen Viewport, Tab-Zeile aus der Toolbar-Überlappung
   lösen. Abnahme per Screenshot im 390er-Viewport.
3. **#1083** „Grant wartet auf Freigabe"-Benachrichtigung feuert auch bei
   auto-freigegebenen Grants. Gleiche Klasse wie #1085: Kanal-Entwertung.
4. **Owner-Entscheidung (#1081):** Exit 75 oder 0 für auto-freigegebene Grants im
   async-Modus? Bewusst offen.
5. **Koordination autonomer Loops:** `openape-operator` und diese Session haben #1081
   parallel bearbeitet (gleicher Branch). Ging gut, weil der Fremd-Commit reviewt statt
   überschrieben wurde — es fehlt ein Issue-Claiming.
6. Danach: Stufe-3-Rollen-Scopes (`openape_role`, protocol#5–#10), #1031 Nest-Rückbau,
   Route-Inventar-Test (#1045).

---

## 3. Fallen (in dieser Session teuer gelernt)

| Falle | Regel |
|---|---|
| `ape-shell` ohne `APE_WAIT` druckt (bis 1.33.3) immer „pending approval" | Auch bei längst auto-freigegebenem Grant. Ground Truth ist der **Grant-Record** (`status`/`auto_approval_kind`), nie die CLI-Prosa. Daraus sind mir zwei Fehldiagnosen entstanden, inkl. unnötigem Prod-Rollback. |
| Ketten-Test nur mit NICHT gelistetem Kommando | `erlaubt && echo …` ist bei erlaubtem `echo *` korrekt approved — beweist nichts. Richtig: `echo hallo && id`. |
| Keine `"` in YOLO-Mustern | Ein `"` überlebt Shell+CLI nicht; Policy kam als einziges Muster `bash` an, der Loop stand. Muster quote-frei (`bash *cockpit-agent.sh*`), Aufruf gequotet (`--allow "$want"`, nie wortgetrennte Argumentliste). |
| `X *` matcht `X` nicht | Jede Form zusätzlich argumentlos aufnehmen. |
| Loop-Innenleben muss erlaubt sein | `cockpit-agent.sh` und `claude-log` sind kein Rollen-Werkzeug — ohne Erlaubnis hängt jeder Task, bevor er anfängt. |
| Delegierter Token ≠ Grant-Identität | Delegierte Tokens tragen `sub=Owner`. Für ape-shell-Grants den Standard-Agent-Token (client_assertion OHNE delegation_grant, aud `apes-cli`, 8 h). |
| `APES_AUTH_FILE` muss in BEIDEN Paketen greifen | apes UND shapes lösen Auth getrennt auf (#1066), sonst laufen Adapter-Grants still unter Owner-Identität. |
| IdP-Rate-Limit | Bulk-Läufe takten (≥45 s, Backoff); `yolo set`/Token-Mints landen im Management- bzw. Agent-Topf (60/120 pro Minute). |
| Deploy = Verhalten prüfen | Nach jedem Deploy den echten Ablauf messen, nicht Health. |
| Merge nur `{"Do":"merge"}` + ls-remote-Phantom-Check, Push `SKIP_HOOKS=1` | unverändert gültig |

---

## 4. Schnell-Verifikation (Session-Start)
```bash
tail -5 ~/.config/openape-worker/worker.log
apes agents list | grep -c "@id.openape"          # muss 6 sein
curl -s https://id.openape.ai/api/health; curl -s https://troop.openape.ai/api/health
```
Policy-Check (Senden darf NICHT enthalten sein):
```bash
apes yolo show --json 'op-delta-mind-cb6bf26a+patrick+hofmann_eco@id.openape.ai' | python3 -c 'import sys,json;p=json.load(sys.stdin)["policy"];x=p["allowPatterns"];print(len(x),"Muster | mail send:",any("mail send" in i for i in x))'
```

## 5. Wichtige Pfade
- Worker: `~/.config/openape-worker/{worker.sh,cockpit-agent.sh,operators.json,operator.env}`
- Gating-Hook (codex): `~/.config/openape-worker/codex-pretooluse-hook.py`
- Pläne: `.claude/plans/2026-07-29-operator-mail-kalender-repo.md`,
  `.claude/plans/2026-07-28-per-company-operators.md`
- Memory: `worker-gated-endgame`, `operator-mail-kalender-betrieb`,
  `idp-rate-limit-starves-owner`, `test-the-refusal-not-the-happy-path`

## 6. Erster Schritt der Folgesession
Die Issues #1085 und #1086 wurden nur aus Patricks Textbeschreibung angelegt. Die
Screenshot-Auswertung in Abschnitt 2 ist **neuer, präziserer Befund** — vor der
Implementierung als Kommentar an die Issues hängen. Der „Zwischenstand"-Spam und der
5-Minuten-Grant-Timeout stehen dort noch gar nicht drin, obwohl beide für sich genommen
eigene Fehler sind (evtl. eigenes Issue).

Screenshots liegen unter
`~/.claude/uploads/f212b9cc-bb91-4997-aabd-92d72489c1b0/` (`7fa8ab92-IMG_0981.PNG` =
Cockpit-Rauschen, `bc3dd58b-IMG_0982.PNG` = Organigramm mobil).
