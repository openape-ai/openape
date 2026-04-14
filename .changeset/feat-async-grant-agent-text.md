---
'@openape/apes': patch
---

feat(apes): agent-facing polling protocol in `apes run` async output + `APES_USER` mode switch

Schließt einen echten UX-Gap der 0.9.0 async-default Releases: der Info-Block der beim Pending-Grant gedruckt wird, erzählt dem AI-Agent jetzt explicit was er als nächstes tun soll — poll-interval, max-wait, behavior bei approved / denied / timeout. Humans können via `APES_USER=human` auf einen kurzen freundlichen Block umschalten.

## Das Problem

0.9.0's async default machte `apes run` / `ape-shell -c` non-blocking: nach Grant-Creation exit 0 mit Info-Text, User muss später `apes grants run <id>` rufen um tatsächlich auszuführen. Für Humans am Terminal war das klar; für AI-Agents (openclaw, Claude Code, ChatGPT) war's unsichtbar — der Agent sah die erfolgreiche `✔` Glyphe und exit 0 und meldete dem User "done", obwohl nichts passiert war. Es gab keine Instruktion im Output-Text, *was* der Agent mit der Grant-ID machen soll, wie lange er polling soll, oder was bei Denial zu tun ist.

## Was neu ist

### 1. Agent-facing polling protocol

Default-Output (wird gezeigt wenn `APES_USER` nicht auf `human` gesetzt ist):

```
✔ Grant e887a7e3-... created (pending approval)
  Approve:   https://id.openape.at/grant-approval?grant_id=e887a7e3-...
  Status:    apes grants status e887a7e3-... [--json]
  Execute:   apes grants run e887a7e3-...

  For agents: poll `apes grants status e887a7e3-... --json` every 10s, wait up to 5 minutes.
  When .status == "approved", run `apes grants run e887a7e3-...` to execute.
  On "denied" or "revoked", stop and report to the user.
  On timeout, stop and notify the user that approval has not happened.

  Tip: Approve as "timed" or "always" in the browser to let this
  grant be reused on subsequent invocations without re-approval.
```

Der Agent bekommt konkrete imperative Instruktionen — poll, run, stop, report — und weiß wie die drei Terminal-States zu handlen sind (approved / denied|revoked / timeout). Per-agent Skill-Definitionen sind damit optional; jeder Agent in jedem Ökosystem bekommt dasselbe Verhalten ohne zusätzliche Konfiguration.

### 2. `APES_USER=human` für Humans

Humans die regelmäßig mit `apes` arbeiten und den verbose Block nervig finden, setzen einmal `export APES_USER=human` in ihrer `.zshrc` und bekommen:

```
✔ Grant e887a7e3-... created — awaiting your approval
  Approve in browser:  https://id.openape.at/grant-approval?grant_id=e887a7e3-...
  Check status:        apes grants status e887a7e3-...
  Run after approval:  apes grants run e887a7e3-...

  Tip: Approve as "timed" or "always" in the browser to reuse
  this grant without re-approval on the next invocation.
```

Kürzer, freundlicher, kein Agent-Polling-Block.

### 3. Konfigurierbares Poll-Interval + Max-Duration

Die 10-Sekunden / 5-Minuten Defaults sind konfigurierbar via Env-Vars und `config.toml`:

```bash
# Env vars (höchste Priorität)
APES_GRANT_POLL_INTERVAL=30        # seconds between polls
APES_GRANT_POLL_MAX_MINUTES=10     # max total wait
```

```toml
# ~/.config/apes/config.toml (lower priority, fallback when env unset)
[defaults]
user = "agent"                       # or "human"
grant_poll_interval_seconds = "30"
grant_poll_max_minutes = "10"
```

Env wins über config, config wins über baked-in defaults. Bogus values (non-numeric, negative) fallen gracefully zum Default. Die Zahlen fließen direkt in den Output-Text, damit der Agent immer die tatsächlich aktuelle Policy sieht — nicht eine hardcoded.

### 4. Default ist agent

Die User-Mode Default-Wahl ist `agent`, nicht `human`. Rationale: Agenten sind die Zielgruppe bei der der Output-Text der einzige Kommunikationskanal ist. Humans können den verbose Block ignorieren — schlimmstenfalls lesen sie zwei extra Absätze. Agenten ohne explizite Instruktionen können den async-Flow gar nicht nutzen. Der konservative Default ist "zero-config für agents, one-line rc für humans".

## Konsistenz-Stabilität für Scripts

Die drei Core-Label-Zeilen bleiben in beiden Modes enthalten und finden sich in jedem Output:

- Die URL enthält immer `grant-approval?grant_id=<uuid>`
- Die Status-Zeile enthält immer `apes grants status <uuid>`
- Die Execute-Zeile enthält immer `apes grants run <uuid>`

Existing Scripts die diese Strings via grep/sed extrahieren brechen nicht. Der Unterschied ist nur der Prosa-Block drumrum.

## Test-Manifest

11 neue Tests in `packages/apes/test/commands-run-async.test.ts` im neuen `async info block audience mode` describe:

1. Default (kein env, keine config): agent mode mit polling protocol
2. `APES_USER=human`: short block, kein polling
3. `APES_USER=agent`: wie default
4. `APES_USER=invalid`: fällt zurück auf agent
5. `config.toml defaults.user=human` überridet den agent default
6. `APES_USER` env wins über `config.toml defaults.user`
7. `APES_GRANT_POLL_INTERVAL=30` fließt in den agent text
8. `APES_GRANT_POLL_MAX_MINUTES=10` fließt in den agent text
9. config fallback für poll interval wenn env unset
10. env wins über config für numeric knobs
11. bogus env values (non-numeric, negative) werden ignored, defaults apply

Plus: zusätzlicher Mock für `loadConfig()` im bestehenden `vi.mock('../src/config.js')` Setup, und Reset-auf-leere-config im `beforeEach` damit `mockReturnValue` aus einem Test nicht in den nächsten leakt.

Full `@openape/apes` suite via turbo: 41 files, **466/466 green** (455 baseline aus 0.9.2 + 11 neu).

## Migration

Keine. Ist ein pure-additive Output-Format-Change. Existing scripts die die Core-Label-Strings grep-en brechen nicht. Wer explicit den alten deutschen Text mit "erstellt" / "Ausführen" / "Tipp" parsed, bricht — aber das war 0.9.0 und wir sind nur 4 Patch-Releases später.
