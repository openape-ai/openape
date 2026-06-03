# Die Änderungen in `@openape/apes@0.10.0`

Kontext: 0.10.0 ist der erste Release in dieser Session der einen **echten breaking change** im CLI-Kontrakt macht — der default-exit-code der async-default-Pfade ändert sich von `0` zu `75` (`EX_TEMPFAIL`). Die Änderung entstand aus einer Live-Observation mit openclaw, die ein fundamentales Limit der 0.9.3 text-first-Strategie offengelegt hat: **AI-Agenten ignorieren explizite imperative Anweisungen in stdout wenn der umschließende Tool-Result als "success" markiert ist.**

Der non-zero exit code ist der strukturelle Attention-Anker den Text-in-Stdout allein nicht liefern kann. Das ist 0.10.0.

## Das Problem — live observiert

Nach 0.9.4 hat Patrick openclaw den Polling-Flow ausprobiert. Openclaw hat `ape-shell -c "date"` ausgeführt, exit 0 gesehen, den ✓ Glyph und "Grant created (pending approval)" im Output, und hat **trotz der expliziten "For agents:" Anweisungen die 0.9.3 eingebaut hatte** die Aktion als "done" interpretiert und Patrick mitgeteilt dass der Command fertig ist. Der User sollte dann bitte approven. Manuell. Wie bei blocking-Mode.

Als Patrick openclaw zur Rede gestellt hat, kam die ehrliche Antwort:

> *"Das war direkt an mich als Agent adressiert — ich hätte es einfach befolgen müssen. Ich hab's schlicht ignoriert."*

Diese Antwort ist das wertvollste Artefakt der gesamten Session: sie hat klar gemacht dass **"Text in stdout" kein belastbarer Kommunikationskanal für imperative Agent-Instruktionen ist.** Agents priorisieren strukturierte Tool-Result-Metadata (status, exit code) deutlich höher als narrative Prose im Output-Content. Ein `success` status + `exit 0` überschreibt jede "you should poll..." Zeile die irgendwo im Text versteckt ist.

## Die Diagnose — openclaw's exec-runtime inspiziert

Ich hab den openclaw exec-runtime Code durchgelesen (`bash-tools.exec.ts`, `bash-tools.exec-runtime.ts`, `bash-process-registry.ts`), um zu verstehen **welcher Kanal tatsächlich Wirkung hat**:

**Fakt 1 — stdout und stderr werden chronologisch interleaved:**

```ts
// bash-tools.exec-runtime.ts:614-627
const handleStdout = (data: string) => {
  const str = sanitizeBinaryOutput(data.toString())
  appendOutput(session, "stdout", chunk)
}
const handleStderr = (data: string) => {
  const str = sanitizeBinaryOutput(data.toString())
  appendOutput(session, "stderr", chunk)
}
```

```ts
// bash-process-registry.ts:106-134
export function appendOutput(session, stream, chunk) {
  // Beide Streams kommen in einen gemeinsamen `aggregated`-Buffer:
  session.aggregated = trimWithCap(session.aggregated + chunk, ...)
}
```

Der LLM sieht `aggregated` — einen einzigen Content-Blob mit stdout und stderr in Write-Order gemixt. **Das heißt: Inhalte auf stderr statt stdout zu routen hätte null Effekt auf den Leseflow.** Die Separation existiert intern, wird aber für die Agent-Präsentation kollabiert.

**Fakt 2 — Der exit code entscheidet den Tool-Result-Typ:**

```ts
// bash-tools.exec.ts:75-92
if (params.outcome.status === "failed") {
  return failedTextResult(`${warningText}${params.outcome.reason}`, {
    status: "failed", exitCode, ...
  })
}
return textResult(`${warningText}${params.outcome.aggregated}`, {
  status: "completed", exitCode, ...
})
```

```ts
// bash-tools.process.ts:357
const status = exitCode === 0 && exitSignal == null ? "completed" : "failed"
```

Zwei verschiedene Tool-Result-Typen die der LLM unterschiedlich konsumiert: `textResult` (success) wird als "task done, move on" gelesen, `failedTextResult` als "something needs attention, read carefully". **Der Unterschied ist strukturell, nicht textuell.**

**Fakt 3 — Automatisches Exit-Code-Footer-Suffix:**

```ts
// bash-tools.exec-runtime.ts:473
const exitMsg = exitCode !== 0 ? `\n\n(Command exited with code ${exitCode})` : ""
```

Bei non-zero exit hängt openclaw zusätzlich einen expliziten `(Command exited with code 75)` Suffix an den output. Zweiter Aufmerksamkeits-Anker im gleichen Kanal: der LLM sieht sowohl die "failed" Annotation im Result-Metadata als auch den expliziten Exit-Code-Hinweis im Text.

## Der Fix — non-zero default exit code

Wenn `apes run` / `ape-shell -c` den async-default-Pfad einschlägt (pending grant erzeugt, `printPendingGrantInfo` ausgibt), wird jetzt `CliExit(75)` geworfen anstatt mit exit 0 zurückzukehren.

### Warum 75 und nicht 1 oder 2

| Code | Konvention | Fit für "pending, retry later" |
|---|---|---|
| `0` | Success | ❌ falsch — Command hat nicht gelaufen |
| `1` | POSIX general error | ❌ generisch, "etwas ist kaputt" Signal |
| `2` | Shell usage error (bash, git) | ❌ liest als "user's fault" |
| `-1` | Nicht POSIX-valid, shells truncieren zu 255 | ❌ nicht portabel |
| `126` | Command found but not executable | ❌ reserviert |
| `127` | Command not found | ❌ reserviert |
| **`75`** | **`EX_TEMPFAIL`** aus `sysexits.h` — "temporary failure, try again later" | ✅ **exakt passend** |

`EX_TEMPFAIL` hat seit BSD-Zeiten als Konvention für "defer and retry" in mail-delivery-tools gelebt (`sendmail`, `postfix`, `qmail`). Dokumentiert in `man sysexits(3)`, über Jahrzehnte in LLM-Trainingsdaten verankert, semantisch nahezu identisch mit "pending grant, retry after approval". Der beste verfügbare Fit.

Alternative Kandidaten die auch gepasst hätten: `73` (`EX_CANTCREAT`), `74` (`EX_IOERR`), `78` (`EX_CONFIG`). Alle schwächer gefittet als 75. Plus 75 hat die bonus-story mit sendmail's "retry later" Semantik.

### Die Implementation

Neuer Helper in `packages/apes/src/commands/run.ts`, analog zu den 0.9.3 Pollinginterval-Helpern:

```ts
function getAsyncExitCode(): number {
  const envValue = process.env.APES_ASYNC_EXIT_CODE
  if (envValue !== undefined && envValue !== '') {
    const n = Number(envValue)
    if (Number.isFinite(n) && n >= 0 && n <= 255)
      return Math.floor(n)
  }
  const cfg = loadConfig()
  const cfgValue = cfg.defaults?.async_exit_code
  if (cfgValue !== undefined && cfgValue !== '') {
    const n = Number(cfgValue)
    if (Number.isFinite(n) && n >= 0 && n <= 255)
      return Math.floor(n)
  }
  return 75 // EX_TEMPFAIL
}
```

Hierarchie: **env → config → baked-in default 75**. Bogus values (non-numeric, negative, >255) fallen gracefully auf den Default zurück.

Und an den vier async-exit-Call-Sites (`runShellMode` session-grant fallback, `tryAdapterModeFromShell`, `runAdapterMode`, `runAudienceMode`) wird jeder `printPendingGrantInfo(grant, idp); return` durch `printPendingGrantInfo(grant, idp); throw new CliExit(getAsyncExitCode())` ersetzt. Der existierende top-level `CliExit` catch in `cli.ts` propagiert den Code korrekt zu `process.exit()`.

## Was openclaw jetzt sieht

**Vorher (0.9.4, async default):**

```
$ ape-shell -c "date"
ℹ Requesting grant for: Show current date and time
✔ Grant e887a7e3-... created (pending approval)
  Approve:   https://id.openape.at/grant-approval?grant_id=e887a7e3-...
  Status:    apes grants status e887a7e3-... [--json]
  Execute:   apes grants run e887a7e3-...

  For agents: poll `apes grants status e887a7e3-... --json` every 10s, wait up to 5 minutes.
  When .status == "approved", run `apes grants run e887a7e3-...` to execute.
  On "denied" or "revoked", stop and report to the user.
  On timeout, stop and notify the user that approval has not happened.

$ echo $?
0
```

→ openclaw's wrapper: `textResult`, `status: "completed"`, `exitCode: 0` → LLM sieht "success" → **ignoriert den Agent-Block**.

**Nachher (0.10.0):**

```
$ ape-shell -c "date"
ℹ Requesting grant for: Show current date and time
✔ Grant e887a7e3-... created (pending approval)
  Approve:   https://id.openape.at/grant-approval?grant_id=e887a7e3-...
  Status:    apes grants status e887a7e3-... [--json]
  Execute:   apes grants run e887a7e3-...

  For agents: poll `apes grants status e887a7e3-... --json` every 10s, wait up to 5 minutes.
  ...

$ echo $?
75
```

→ openclaw's wrapper: `failedTextResult`, `status: "failed"`, `exitCode: 75` → **plus automatisches `(Command exited with code 75)` Suffix** → LLM sieht "failed" Status + explicit exit code → liest den Output aufmerksam → findet die "For agents:" Instruktionen → **folgt ihnen**.

Der Output-Content ist **identisch**. Nur der strukturelle Metadata-Anker (status + exit code) ist neu. Das ist der ganze Fix — das Protokoll war schon da, nur der Attention-Anker hat gefehlt.

## Configurability — drei Override-Ebenen

**1. Environment variable (höchste Priorität)**

```bash
APES_ASYNC_EXIT_CODE=0    # restore pre-0.10.0 exit-0 behaviour
APES_ASYNC_EXIT_CODE=2    # alternative: shell usage error convention
APES_ASYNC_EXIT_CODE=7    # alternative: arbitrary distinctive code
```

**2. `~/.config/apes/config.toml` (fallback wenn env unset)**

```toml
[defaults]
async_exit_code = "0"
# oder
async_exit_code = "75"
```

**3. Baked-in default wenn weder env noch config gesetzt: `75`**

**Validation:** nur numerische Werte im POSIX-Bereich 0–255 werden akzeptiert. `not-a-number`, `-1`, `256`, leerer string, und jeder andere Unsinn fallen gracefully auf den jeweils niedrigeren Layer (config → 75 default).

## Was sich NICHT ändert

- **`--wait` Flag oder `APE_WAIT=1`**: der legacy blocking-Pfad liefert **immer** exit 0 on successful exec, egal was `APES_ASYNC_EXIT_CODE` sagt. Wer die alte Semantik will: `apes run --wait -- curl example.com`.

- **Cache-Hits** (`findExistingGrant` im Adapter-Pfad, session-grant-reuse im shell-Pfad): immer exit 0. Die Commands laufen direkt durch, es gibt keinen pending state.

- **Self-dispatch shortcut** für `apes <subcmd>` inside ape-shell (eingeführt in 0.9.2/0.9.4): immer exit 0. Wird direkt via `execShellCommand` ausgeführt, umgeht den grant flow komplett.

- **Der Output-Content der async info blocks** — Approve URL, Status command, Execute command, "For agents:" block, Tipp — **alles identisch**. Scripts die diese Labels via grep/sed extrahieren brechen nicht.

## Migration

### Für CI-Scripts die `$?` nach `apes run` checken

```bash
# Vorher (implizit exit 0 assumption):
apes run -- curl example.com && echo done

# Option 1: explicit --wait (blockiert bis approval, returniert 0)
apes run --wait -- curl example.com && echo done

# Option 2: APE_WAIT env var (gleiches Ergebnis)
APE_WAIT=1 apes run -- curl example.com && echo done

# Option 3: expect the new exit code explicitly
apes run -- curl example.com
if [ $? -eq 75 ]; then echo "grant pending, need approval"; fi

# Option 4: restore legacy behaviour for this one shell session
APES_ASYNC_EXIT_CODE=0 apes run -- curl example.com && echo done
```

### Für AI-Agent-Frameworks (Claude Code, openclaw, Cursor, etc.)

**Keine Migration nötig.** Der neue exit code ist **exakt der Effekt den wir wollten**: tool-result wird als `failed` präsentiert, LLM liest den Output aufmerksamer, Agent folgt den "For agents:" Instruktionen. Das ist der happy path.

**Ausnahme**: falls ein Framework den non-zero exit code als "task irrecoverably failed, abort the whole workflow" interpretiert (statt als "needs attention, read the output carefully"), dann braucht es einen custom handler der `exitCode === 75` speziell als "pending state, not an error" mapped. Das ist aber ein Framework-Design-Problem, nicht ein Problem mit apes.

### Für Humans am Terminal

Das `$?` nach einem `apes run` ist jetzt 75. Für die meisten interaktiven Workflows irrelevant — man liest den Output direkt und folgt der `Execute: apes grants run <id>` Zeile manuell. Wer konsistent exit 0 will:

```bash
# ~/.zshrc
export APES_ASYNC_EXIT_CODE=0
```

Oder:
```toml
# ~/.config/apes/config.toml
[defaults]
async_exit_code = "0"
```

## Test-Manifest

**11 neue Tests** in `packages/apes/test/commands-run-async.test.ts` im neuen `async exit code (APES_ASYNC_EXIT_CODE)` describe-Block:

| # | Test | Verifies |
|---|---|---|
| 1 | default: throws CliExit(75) | baked-in default correct |
| 2 | `APES_ASYNC_EXIT_CODE=0` | restore legacy exit-0 |
| 3 | `=2` | custom numeric override |
| 4 | `=255` | maximum POSIX exit code accepted |
| 5 | `=256` | out of range → fallback to 75 |
| 6 | `=-1` | negative → fallback to 75 |
| 7 | `=not-a-number` | non-numeric → fallback to 75 |
| 8 | empty string | fallback to 75 |
| 9 | `config.toml defaults.async_exit_code` | config fallback when env unset |
| 10 | env wins over config | priority hierarchy correct |
| 11 | `--wait` mode unaffected | blocking path returns 0 even with `APES_ASYNC_EXIT_CODE=99` |

**Plus: 20 bestehende Tests mit neuem `expectCliExit` helper gewrappt**

Der Helper fängt die `CliExit` exception und assertiert den erwarteten Code. Bestehende `await runCommand.run!({...})` calls in async-exit-Pfaden werden zu `await expectCliExit(runCommand.run!({...}))` (default expectedCode = 75). Die `--wait` Tests bleiben unverändert weil sie den blocking-Pfad triggern der immer 0 returniert.

**Regression:**
- `shell-grant-dispatch.test.ts`: 27/27 green (0.9.2 REPL behavior untouched)
- `commands-run-async.test.ts`: **43/43 green** (32 wrapped baseline + 11 new)
- Full `@openape/apes` suite via turbo: **41 files / 488 green** (477 baseline from 0.9.4 + 11 new)

## Release-Pipeline

| Stage | SHA / Run |
|---|---|
| Worktree von `origin/main` (`6dbd4bb`) | ✓ |
| `getAsyncExitCode()` helper + 4 site edits + 20 test wrap edits + 11 new tests | `5ba1188` |
| PR #102 pushed → validate | ✓ |
| Admin squash-merge PR #102 | `02551c3` |
| ci + release auf `02551c3` → opens version-packages PR #103 | ✓ |
| Admin squash-merge PR #103 (version packages) | `d087152` |
| ci + release auf `d087152` → **npm publish** | `24417292102` ✓ |
| `npm view @openape/apes@0.10.0` | **0.10.0** ✓ |
| main fast-forwarded, rebuilt, homebrew updated | ✓ |
| Alle vier Install-Pfade (`/usr/local/bin/apes`, `/usr/local/bin/ape-shell`, `/opt/homebrew/bin/apes`, `/opt/homebrew/bin/ape-shell`) | **0.10.0** ✓ |

## Files-Manifest

**Source (geändert):**

- `packages/apes/src/commands/run.ts` — neuer `getAsyncExitCode()` Helper, `throw new CliExit(getAsyncExitCode())` an allen vier async-exit Sites (`runShellMode` session-grant fallback, `tryAdapterModeFromShell`, `runAdapterMode`, `runAudienceMode`)

- `packages/apes/src/config.ts` — neues `defaults.async_exit_code?: string` Feld im `ApesConfig` Interface mit vollständiger Dokumentation

**Tests (erweitert):**

- `packages/apes/test/commands-run-async.test.ts` — neuer `expectCliExit(promise, expectedCode)` Helper an der Spitze des describe-Blocks, 20 bestehende baseline-Tests gewrappt, `driveRun` und `driveShellMode` helper-Funktionen erweitert mit optionalem expected-exit-code parameter, 11 neue Tests im `async exit code (APES_ASYNC_EXIT_CODE)` describe-Block

**Changeset:**

- `.changeset/feat-async-exit-code.md` — minor bump (`0.9.4 → 0.10.0`) mit vollständiger Breaking-Change-Dokumentation und Migration-Guide

## Die große Lektion dieser Session

0.9.3 hat text-first als Agent-Instruction-Mechanismus propagiert. Ich hab dir damals verkauft dass expliziter Prose-Text in stdout ausreichen würde weil er portable (jeder Agent sieht ihn), versioned (er embedded die aktuelle Policy), und debuggbar (du kannst mitlesen) wäre.

**Das war richtig in der Theorie, aber unzureichend in der Praxis.** Openclaw's Behaviour hat den Grund aufgedeckt: LLMs priorisieren strukturierte Tool-Result-Metadata (status, exit code, success/fail annotation) **deutlich höher** als narrative Prose im Output-Content. Ein `success` mit instruktivem Text wird als "task done" gelesen, weil der strukturelle Anker das trained-in "✓ success = move on" Verhalten triggert.

Der non-zero exit code in 0.10.0 ist ein **strukturaler Kanal, nicht ein textueller**. Er ist nicht duplicate information — er ist die fehlende zweite Achse der Kommunikation. Text liefert den Content ("do this"), exit code liefert die Priorität ("pay attention to this"). Beide zusammen sind notwendig.

**Das übertragbare Muster für zukünftige Tool-zu-Agent Kommunikation:**

> *"When you want an agent to follow specific instructions in your tool output, you need two things: (1) the instructions themselves in the content, and (2) a structural metadata anchor — exit code, stderr routing, tool-result status, or framework-specific priority flag — that makes the agent read the content with elevated attention. Content alone is necessary but not sufficient. Structural metadata without content is also not sufficient. Both together work."*

Das ist die Lektion die ich aus dieser Session tatsächlich mitnehme. Text-first war eine unvollständige Theorie. Text-plus-structural-anchor ist die richtige.

## Nachfolge-Arbeit (out-of-scope für 0.10.0)

- **Workflow-File für `apes workflow show async-grant`**: weiterhin offen. Wäre der lange-Form Protokoll-Dokument-Home für Agent-Frameworks die tiefer tauchen wollen als die CLI-Output-Hinweise.

- **Claude Code Skill** (`.claude/skills/apes-async-grant.md`): ein-Zeilen-Skill der sagt "wenn `apes run` Output einen `For agents:` Block enthält, folge den Instructions literal; der exit code signalisiert pending state, nicht Fehler". Kostet 2 Minuten, sichert den edge case dass ein Claude-Agent den exit code 75 als "kaputtes Tool" fehlinterpretiert.

- **Der `extractPositionals` Bug** aus run.ts:286-298: weiterhin pre-existing, wartet auf separaten Fix.

- **Tripwire-Test der gegen openclaw läuft**: ein echter End-to-End Test der einen Agent gegen den IdP fahren lässt und verifiziert dass er den async-grant-Flow korrekt durchsteht. Nicht in 0.10.0 — größerer Scope, eigener plan. Wäre aber die beste regression-guard die wir haben könnten.

## Lineage

`0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2 → 0.9.3 → 0.9.4 → 0.10.0`

**Acht Releases** in einer Session, **sechs Dokumente** auf dem Desktop. Jeder Release entstand aus live-observation, nicht aus pre-planning. Das ist das wertvollste Rollen-Muster der ganzen Session: **release → live-test → find real-world divergence → fix → release → repeat**, mit kurzem Abstand zwischen jedem Zyklus.
