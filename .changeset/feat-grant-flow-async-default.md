---
'@openape/apes': minor
---

feat(apes): `apes run` / `ape-shell -c` default auf async, neuer `apes grants run <id>` Subcommand

**BREAKING CHANGE** — wer `apes run` oder `ape-shell -c "<cmd>"` heute scriptet und auf den Exit-Code des _tatsächlichen_ Kommandos verlässt, muss `--wait` oder `APE_WAIT=1` setzen.

## Warum

Vor dieser Änderung blockierte jeder `apes run` / `ape-shell -c` Aufruf, der einen neuen Grant benötigte, bis zu 5 Minuten in einer 3s-Polling-Schleife, während der User auf dem Handy approven sollte. Für CI-Skripte war das OK, für interaktive Nutzer nervig und für AI-Agenten (openclaw, claude code, etc.) ein hartes Blocker-Pattern: der Agent stand still, bis der Mensch fertig war, und konnte nichts Anderes parallel erledigen.

## Was neu ist

### Default: async print-and-exit

Wenn `apes run -- <cmd>` oder `ape-shell -c "<cmd>"` einen neuen Grant erzeugt, druckt der Command jetzt die Approve-URL und den Follow-up-Pfad und exitet sofort mit Code 0:

```
$ apes run -- curl https://example.com
ℹ Requesting grant for: Execute with elevated privileges: curl
✔ Grant 7b3a9e2c-... erstellt
  Approve:   https://id.openape.at/grant-approval?grant_id=7b3a9e2c-...
  Status:    apes grants status 7b3a9e2c-...
  Ausführen: apes grants run 7b3a9e2c-...

  Tipp: Im Browser "als timed/always approven" wählen, um das
  Kommando ohne erneuten Approval wiederzuverwenden.
```

Der User approved im Browser, ruft dann `apes grants run 7b3a9e2c-...` und bekommt den tatsächlichen Command-Output.

### Cache-Hits unverändert

Wenn bereits ein approved timed/always-Grant existiert (via `findExistingGrant` im Adapter-Pfad oder den Session-Grant-Lookup), führt die Erstinvocation direkt aus — kein Async-Zwischenschritt. Nur der Pending-Fall ändert sich.

### Neuer Subcommand: `apes grants run <id>`

Führt einen approved Grant aus. Dispatcht nach Grant-Typ:

- **Shapes-Grants**: lädt den Adapter lokal, re-resolved den `ResolvedCommand` gegen den recorded `execution_context.adapter_digest` (wirft bei mismatch), holt den Token via `fetchGrantToken`, und führt via `verifyAndExecute` aus.
- **Escapes-Grants** (`audience === 'escapes'`): holt das `authz_jwt` und pipet an `escapes --grant <jwt> -- <cmd>`.
- **Legacy `ape-shell` Session-Grants**: nicht re-executable — der Command gibt einen klaren Hinweis aus (session grants waren single-use gegen eine spezifische `bash -c` Zeile; der User soll stattdessen den Original-Aufruf wiederholen, der dann via `findExistingGrant` timed/always-Grants wiederverwendet).

Status-Gates: `pending` → Hinweis + approve-URL, `denied`/`revoked` → Error, `used` → Error ("already been used — request a new one"), `approved` → dispatch.

### Override für Legacy-Workflows

- **`apes run --wait`** / **`ape-shell -c --wait ...`** (CLI flag): erzwingt altes blockierendes Verhalten.
- **`APE_WAIT=1`** (env var): gleiches Ergebnis aus der Umgebung heraus, für Fälle wo Flags nicht durchgereicht werden können (z.B. sshd-login-shell, cron, `$SHELL -c` aus einem Binary).

Beide sind äquivalent und aktivieren denselben Legacy-Pfad in allen vier betroffenen Sub-Flows (`runShellMode` Session-Grant, `tryAdapterModeFromShell`, `runAdapterMode`, `runAudienceMode`).

### Interactive REPL bleibt unverändert

Der `ape-shell`-REPL (ohne `-c`) hat seine eigene Verify-/Consume-Pipeline über `shell/orchestrator.ts` und ist von dieser Änderung nicht betroffen. Die REPL-Experience bleibt identisch zu 0.8.0 — blocking wait mit dem in 0.8.0 ergänzten `Grant <id> approved — continuing` Acknowledgment.

### Komposition mit #84

Diese Änderung paart sich natürlich mit der in 0.8.0 gelandeten `APES_NOTIFY_PENDING_COMMAND` (PR #84): bei jedem Grant-Creation feuert sowohl der async Exit auf stdout als auch die konfigurierte out-of-band Notification (Telegram/osascript/beliebig). Der User merkt den Grant-Request auch wenn er gerade nicht aufs Terminal schaut.

## Migration

Für CI-Skripte:

```bash
# Vorher (implizit blocking):
apes run -- curl https://example.com

# Nachher (explizit blocking):
apes run --wait -- curl https://example.com
# oder
APE_WAIT=1 apes run -- curl https://example.com
```

Für sshd/cron-Workflows die `ape-shell` als Login-Shell fahren: `APE_WAIT=1` global in `.pam_environment`, systemd unit, oder direkt in der Cron-Expression setzen.
