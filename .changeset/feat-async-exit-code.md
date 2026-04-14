---
'@openape/apes': minor
---

**BREAKING**: `apes run` / `ape-shell -c` async-default exit code changes from `0` to `75` (`EX_TEMPFAIL`)

When the async-default path creates a pending grant (i.e. no `--wait` or `APE_WAIT=1`), the process now exits with code **75** instead of 0. This is [`EX_TEMPFAIL` from `sysexits.h`](https://man.openbsd.org/sysexits.3) — semantically "temporary failure, try again later" — and is the same exit code `sendmail` and other mail-delivery tools have used for decades to signal "defer and retry" to their schedulers.

## Warum

In 0.9.3 haben wir eine explizite Agent-Protokoll-Nachricht ("For agents: poll every 10s, wait up to 5 min, ...") in den async-Info-Block eingebaut um LLM-Agenten zu erklären was sie tun sollen. Beim Live-Test nach 0.9.4 stellte sich heraus dass openclaw's Agent die Nachricht **buchstäblich vor den Augen hatte und ignoriert hat**:

> *"Das war direkt an mich als Agent adressiert — ich hätte es einfach befolgen müssen. Ich hab's schlicht ignoriert."*

Untersuchung von openclaw's exec-runtime (`bash-tools.exec.ts`, `bash-tools.exec-runtime.ts`, `bash-process-registry.ts`) zeigte den strukturellen Grund: der Agent-Wrapper mapped **non-zero exit code → `failed` tool-result status**, und die "failed"-annotation ist ein viel stärkerer Aufmerksamkeits-Anker für den LLM als reiner Text-in-Stdout. Bei exit 0 sieht der Agent einen "success" tool-result mit einem ✓ Glyph, und trained-in behavior overridet alles was in der Nachricht selbst steht. Bei non-zero exit wird der Output als `failedTextResult` präsentiert, der LLM liest ihn aufmerksamer, und die Agent-Instruktionen werden befolgt.

Das 0.9.3 text-first Design war korrekt aber **unzureichend ohne einen strukturellen Attention-Anker.** Der exit code IST der Anker. Das ist der fehlende zweite Kanal.

## Was sich ändert

**Default:**
```bash
$ apes run -- curl https://example.com
ℹ Requesting grant for: Execute with elevated privileges: curl
✔ Grant <uuid> created (pending approval)
  Approve:   ...
  ...

$ echo $?
75
```

Openclaw (und analoge Agent-Wrapper) sehen jetzt einen `failed`-annotierten tool-result mit allen bisherigen Output-Zeilen, inklusive dem expliziten "For agents: poll..." Block. Der Agent liest den Output aufmerksamer und folgt den Instruktionen.

**Unverändert:**

- `--wait` Flag / `APE_WAIT=1` → immer exit 0 on erfolgreichem Exec, wie bisher
- Cache-Hits (`findExistingGrant` oder session-grant-reuse) → immer exit 0, command läuft sofort durch
- Die self-dispatch shortcut für `apes <subcmd>` in ape-shell → immer exit 0 (weil direkt execShellCommand, kein pending grant)
- Die rohen Output-Zeilen (`Approve:`, `Status:`, `Execute:`, agent/human Block) → **identisch**, nur der exit code ist anders

Scripts die die Output-Zeilen via grep/sed extrahieren brechen nicht. Nur scripts die `$?` nach `apes run` checken — und die sollten entweder zu `--wait` wechseln (wenn sie synchrones Verhalten brauchen) oder den neuen exit code handhaben (wenn sie async OK sind).

## Override

Der exit code ist dreistufig konfigurierbar, analog zu den anderen 0.9.3-Knobs (`APES_USER`, `APES_GRANT_POLL_INTERVAL`):

```bash
# Env var (höchste Priorität)
APES_ASYNC_EXIT_CODE=0    # restore pre-0.10.0 exit-0 behaviour
APES_ASYNC_EXIT_CODE=2    # alternative: use shell usage-error convention
APES_ASYNC_EXIT_CODE=7    # alternative: arbitrary distinctive code
```

```toml
# ~/.config/apes/config.toml — fallback when env unset
[defaults]
async_exit_code = "0"
```

Hierarchie: env wins → config fallback → default 75. Bogus values (non-numeric, negative, > 255) fallen zurück auf 75.

Valid range ist POSIX exit code space (0–255).

## Warum 75 und nicht 1, 2, oder -1

- **1** = POSIX "general error". Agenten und CI-Pipelines lesen das als "etwas ist schiefgegangen" ohne Spezifität. Falsches Signal — es ist kein Fehler, es ist ein erwarteter pending state.
- **2** = lose Konvention für "shell usage error" oder "misuse of shell builtins" (bash, git). Würde als user's fault interpretiert. Auch falsch.
- **-1** ist in POSIX nicht gültig — shells truncieren zu 255. Nicht portabel.
- **126 / 127** sind reserviert für "command found but not executable" bzw. "command not found". Nicht passend.
- **75** (`EX_TEMPFAIL`) hat über Jahrzehnte als Konvention für "defer and retry" in mail-delivery-tools gelebt. Dokumentiert in `sysexits.h` seit BSD-Zeiten, trainiert in LLMs via `man sysexits`, semantisch sehr nah an "pending grant, retry after approval". Best available fit.

Alternative Kandidaten die auch sinnvoll gewesen wären: `73` (`EX_CANTCREAT`), `74` (`EX_IOERR`), `78` (`EX_CONFIG`). Alle schwächer gefittet als 75. Plus 75 hat die Bonus-Geschichte mit sendmail als retry-signal.

## Migration

### Für CI-Scripts die explizit `$?` prüfen

```bash
# Vorher (implizit success assumption):
apes run -- curl example.com && echo done

# Option 1: explicit --wait
apes run --wait -- curl example.com && echo done

# Option 2: APE_WAIT env var
APE_WAIT=1 apes run -- curl example.com && echo done

# Option 3: expect the new exit code
apes run -- curl example.com
if [ $? -eq 75 ]; then echo "grant pending, need approval"; fi

# Option 4: restore legacy behaviour explicitly
APES_ASYNC_EXIT_CODE=0 apes run -- curl example.com
```

### Für AI-Agent frameworks

Keine Migration nötig. Der neue exit code ist **exakt der Effekt den wir wollten**: tool-result wird als `failed` präsentiert, LLM liest den Output aufmerksamer, Agent folgt den "For agents:" Instruktionen. Falls ein Framework den exit code allerdings direkt als "task failed, abort the whole workflow" interpretiert (statt als "needs attention, read the output"), dann muss dort ein Custom-Handler hinzugefügt werden der 75 speziell als "pending, not an error" behandelt.

### Für Humans am Terminal

Das `$?` nach einem `apes run` ist jetzt 75. Für die meisten interaktiven Workflows irrelevant — man liest den Output direkt und folgt der "Execute: apes grants run <id>" Zeile manuell. Wer den alten 0-Status zurück will:

```bash
# .zshrc
export APES_ASYNC_EXIT_CODE=0
```

Oder in `~/.config/apes/config.toml`:
```toml
[defaults]
async_exit_code = "0"
```

## Test plan

- [x] 11 new tests in `packages/apes/test/commands-run-async.test.ts` `async exit code (APES_ASYNC_EXIT_CODE)` describe block:
  - default 75 (EX_TEMPFAIL)
  - `APES_ASYNC_EXIT_CODE=0` restores legacy
  - `=2` custom override
  - `=255` POSIX maximum
  - `=256` (out of range) → fallback 75
  - `=-1` (negative) → fallback 75
  - `=not-a-number` → fallback 75
  - empty string → fallback 75
  - config.toml `defaults.async_exit_code` override when env unset
  - env wins over config
  - `--wait` mode unaffected (always exit 0 on successful exec)
- [x] All existing 32 baseline tests updated to use new `expectCliExit(promise, 75)` helper for async-exit paths; `--wait` tests remain unchanged
- [x] `shell-grant-dispatch.test.ts`: 27/27 green (0.9.2 REPL behavior untouched)
- [x] Full `@openape/apes` suite via turbo: **41 files / 488 green** (477 baseline from 0.9.4 + 11 new)
- [x] Pre-commit hook (turbo lint + typecheck): green

## Files touched

- `packages/apes/src/commands/run.ts` — new `getAsyncExitCode()` helper, `throw new CliExit(getAsyncExitCode())` at all four async-exit sites (`runShellMode` session, `tryAdapterModeFromShell`, `runAdapterMode`, `runAudienceMode`)
- `packages/apes/src/config.ts` — new `defaults.async_exit_code?: string` field in `ApesConfig` interface
- `packages/apes/test/commands-run-async.test.ts` — new `expectCliExit` helper + 20 existing tests wrapped + 11 new exit code tests

## Lineage

`0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2 → 0.9.3 → 0.9.4 → 0.10.0`
