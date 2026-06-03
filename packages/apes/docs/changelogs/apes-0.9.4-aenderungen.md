# Die Änderungen in `@openape/apes@0.9.4`

Kontext: 0.9.4 behebt einen Rekursions-Loop den der openclaw-Agent beim Live-Test nach 0.9.3 aufgedeckt hat. Das 0.9.2 self-dispatch shortcut (der `apes <subcmd>` aus der interaktiven REPL exemptiert) existierte nur in einer der beiden Dispatch-Code-Pfade. Der andere Pfad — der `ape-shell -c "<cmd>"` one-shot Flow — ging weiter durch den vollen Grant-Flow und produzierte einen Grant-Cascade sobald ein Agent anfing zu pollen. Plus: ein verwandter `APES_SHELL_WRAPPER` env-Leak im gleichen Pfad (Finding 4 aus 0.8.0, aber auf `execShellCommand` statt `pty-bridge`).

## Das Problem — live gefunden

Openclaw's Agent-Run, geschildert in der Live-Session:

```
agent history:
für 'date' aus

Neue Version — jetzt mit Anleitung für Agents! 🎉 Ich poll den Status:

apes grants status geht wieder durch ape-shell. Bitte bestätige den date-Grant:
https://id.openape.at/grant-approval?grant_id=4e0a1b6e-0d85-4d2c-87cb-2dbcc30257fc
```

Was Patrick in der IdP-UI sah:

1. Ein Grant für `date` — das ist richtig, `date` ist ein externer Command
2. **Ein zweiter Grant** für `bash -c apes grants status 4e0a1b6e-... --json` — das ist der Bug, der Polling-Call selbst hat einen Grant erzeugt

Beide approved → Agent blieb trotzdem stocken. Patrick's Diagnose:

> *"ich denke dass apes wohl wieder durch die grants läuft obwohl es eigentlich immer ausgeführt werden soll — apes ist erlaubt haben wir gesagt"*

Das war exakt richtig.

## Warum es kaputt war — zwei Leaks im gleichen Pfad

### Leak #1 — self-dispatch shortcut nur im REPL

0.9.2 hat den self-dispatch shortcut in `packages/apes/src/shell/grant-dispatch.ts` eingeführt. Die Blocklist `APES_GATED_SUBCOMMANDS = new Set(['run', 'fetch', 'mcp'])` und die `isApesSelfDispatch` Logik lebten dort inline. Die Funktion `requestGrantForShellLine` wird ausschließlich von `shell/orchestrator.ts` aufgerufen — der **interaktiven REPL**.

Openclaw spawnt aber `ape-shell -c "apes grants status <id> --json"` als Child-Prozess, nicht durch eine REPL-Session. Der Flow ist komplett anders:

1. `ape-shell -c "apes grants status <id> --json"` wird gestartet
2. `rewriteApeShellArgs` in `ape-shell.ts` rewrited zu `apes run --shell -- bash -c "apes grants status <id> --json"`
3. Citty dispatcht zu `runCommand.run()` → `runShellMode()` in `packages/apes/src/commands/run.ts`
4. **Der 0.9.2 shortcut greift hier NICHT** — es gibt keinen self-dispatch Check in `runShellMode`, sondern einen Aufruf zu `tryAdapterModeFromShell`
5. Der Adapter-Pfad versucht den apes-Adapter zu laden und die Operation zu resolven
6. Falls es fehlschlägt (z.B. weil `apes grants status --json` mit den Flags nicht sauber gegen den Adapter matched), fällt es durch zum Session-Grant-Pfad
7. Session-Grant-Pfad kreiert einen Grant mit `command = ['bash', '-c', 'apes grants status <id> --json']` — genau was Patrick im IdP sah

Ergebnis: jeder Poll-Call produziert einen neuen Pending-Grant, jeder Grant braucht approval, und wenn openclaw das als Loop fährt → Turtles all the way down.

### Leak #2 — `execShellCommand` inheritete `APES_SHELL_WRAPPER`

Selbst wenn wir das shortcut-Problem behoben hatten, gab es noch einen zweiten env-Leak. `execShellCommand` in `commands/run.ts` rief:

```ts
execFileSync(command[0]!, command.slice(1), { stdio: 'inherit' })
```

Kein explizites `env` — bash child inheritet den parent-env samt `APES_SHELL_WRAPPER=1` (das der ape-shell-wrapper.sh script setzt damit `rewriteApeShellArgs` die wrapper-invocation detected). Wenn die bash-Zeile dann `apes grants status <id>` als child execs, sieht der nested apes den env var, `rewriteApeShellArgs` detected wrapper-mode, keine der Rules matched die argv-shape, → `action: 'error'` → `cli.ts:84` druckt "ape-shell: unsupported invocation" → exit 1.

Das ist **exakt** Finding 4 aus 0.8.0 (der Leak im pty-bridge für die REPL), nur auf dem anderen Code-Pfad. Patrick hat's damals für die REPL gefixt (pty-bridge.ts), aber `execShellCommand` in commands/run.ts blieb mit demselben Pattern.

## Der Fix — ein shared Module + zwei Call-Site edits

### 1. Neuer shared Module `packages/apes/src/shell/apes-self-dispatch.ts`

Extrahiert `APES_GATED_SUBCOMMANDS` und `isApesSelfDispatch` als single source of truth. Keine Logik-Duplikation mehr zwischen REPL und one-shot Pfad.

```ts
export const APES_GATED_SUBCOMMANDS = new Set(['run', 'fetch', 'mcp'])

export function isApesSelfDispatch(parsed: ParsedShellCommand | null | undefined): boolean {
  if (!parsed || parsed.isCompound) return false
  const invokedName = basename(parsed.executable)
  if (invokedName !== 'apes' && invokedName !== 'apes.js') return false
  const subCommand = parsed.argv[0]
  if (!subCommand) return false
  return !APES_GATED_SUBCOMMANDS.has(subCommand)
}
```

### 2. `shell/grant-dispatch.ts` — imports statt inline

Die interaktive REPL-Path wird leicht refactored. Die inline-deklarierte Blocklist + Check verschwinden, der shared `isApesSelfDispatch` wird importiert. Verhalten unverändert, 27 bestehende Tests bleiben grün.

### 3. `commands/run.ts runShellMode` — neuer early-return vor `tryAdapterModeFromShell`

Das ist der eigentliche Kern-Fix für Leak #1:

```ts
const innerLine = extractShellCommandString(command)
if (innerLine) {
  const parsedInner = parseShellCommand(innerLine)
  if (isApesSelfDispatch(parsedInner)) {
    execShellCommand(command)
    return
  }
}
```

Wenn `ape-shell -c "apes grants status <id>"` reinkommt:
- `command` ist `['bash', '-c', 'apes grants status <id> --json']`
- `extractShellCommandString(command)` → `'apes grants status <id> --json'`
- `parseShellCommand(...)` → `{ executable: 'apes', argv: ['grants', 'status', '<id>', '--json'], isCompound: false }`
- `isApesSelfDispatch(parsed)` → `'grants'` ist nicht in der gated list → `true`
- `execShellCommand(command)` → bash spawnt, führt die Zeile aus, done

**Kein Grant, kein Wait-Loop, kein Approve-Request, kein Cascade.**

### 4. `execShellCommand` + `runAudienceMode` escapes-pipe env strip

Beide `execFileSync` Call-Sites in `commands/run.ts` strippen jetzt `APES_SHELL_WRAPPER` aus dem env den sie an ihre children weitergeben:

```ts
const { APES_SHELL_WRAPPER: _wrapperMarker, ...inheritedEnv } = process.env
execFileSync(command[0]!, command.slice(1), {
  stdio: 'inherit',
  env: inheritedEnv,
})
```

Das ist dieselbe Ein-Zeilen-Destructure wie in `pty-bridge.ts` aus 0.8.0. Jetzt auf dem one-shot Pfad. Defense in depth: selbst wenn jemand in Zukunft einen neuen Call-Path einbaut der durch `execShellCommand` läuft, bleibt der env-strip als automatischer Schutz.

## Warum ein shared Module statt Duplikation

Die Alternative wäre gewesen, die Blocklist und den Check einfach in beide Files lokal zu kopieren. Das wären ~10 Zeilen pro Seite. Klein, aber mit einem echten Drift-Risiko: wenn jemand später `APES_GATED_SUBCOMMANDS` in einem der beiden Files editiert (z.B. um ein neues "gefährliches" Subcommand hinzuzufügen) und den anderen File vergisst, läuft ein inkonsistentes Gating-Modell — shell-internal in einem Pfad, grant-required im anderen. Das wäre ein hässlicher silent divergence bug.

Shared Module macht die Regel explizit, und der Tripwire-Test aus 0.9.2 (der behavioral die exakte Gating-Set in `shell-grant-dispatch.test.ts` überprüft) bleibt weiterhin der Integrity-Check gegen neue Subcommand-Additions.

## Test-Manifest

**11 neue Tests** in `packages/apes/test/commands-run-async.test.ts` in zwei neuen describe-Blöcken:

### `runShellMode apes self-dispatch shortcut` (9 Tests)

Nachweis dass der Shortcut im one-shot Pfad exakt dieselben Semantik wie im REPL-Pfad hat:

1. `ape-shell -c "apes grants status <id> --json"` bypasses grant flow, execs directly → **der openclaw Case**
2. `ape-shell -c "apes grants run <id>"` bypasses (der async bootstrap case)
3. `ape-shell -c "apes whoami"` bypasses
4. `ape-shell -c "apes adapter install curl"` bypasses
5. `ape-shell -c "apes run -- echo hi"` **STAYS gated** (`run` ist in blocklist)
6. `ape-shell -c "apes fetch https://example.com"` **STAYS gated**
7. `ape-shell -c "apes mcp server"` **STAYS gated**
8. `ape-shell -c "apes whoami | grep alice"` (compound) short-circuits nicht — fällt zur session path
9. `ape-shell -c "curl example.com"` (non-apes) short-circuits nicht — adapter path runs

### `execShellCommand APES_SHELL_WRAPPER env strip` (2 Tests)

Nachweis dass der env-Leak tatsächlich gestopt ist:

10. `execShellCommand` strippt `APES_SHELL_WRAPPER` aus der bash child env beim self-dispatching
11. `runAudienceMode` escapes pipe strippt `APES_SHELL_WRAPPER` aus dem escapes subprocess env

Beide Tests assertion-based auf dem Mock von `node:child_process.execFileSync`: inspizieren die `options.env` im `mock.calls[0]` und checken `opts.env.APES_SHELL_WRAPPER === undefined`.

**Regression:**
- `shell-grant-dispatch.test.ts`: **27/27 green** (0.9.2 baseline preserved via shared module)
- `commands-run-async.test.ts`: **32/32 green** (21 baseline aus 0.9.3 + 11 neu)
- Full `@openape/apes` suite via turbo: **41 files / 477 green** (466 baseline aus 0.9.3 + 11 neu)

## Release-Pipeline

| Stage | SHA / Run |
|---|---|
| Worktree von `origin/main` (`2667784`) | ✓ |
| Shared Module + 3 file edits + 11 neue Tests | `610393a` |
| PR #100 pushed → validate | ✓ |
| Admin squash-merge PR #100 | `58cf238` |
| ci + release auf `58cf238` → opens version-packages PR #101 | ✓ |
| Admin squash-merge PR #101 | `6dbd4bb` |
| ci + release auf `6dbd4bb` → **npm publish** | ✓ |
| `npm view @openape/apes@0.9.4` | **0.9.4** ✓ |
| main fast-forwarded, rebuilt, homebrew updated | ✓ |
| Alle vier Install-Pfade | **0.9.4** ✓ |

## Files-Manifest

**Source (neu):**
- `packages/apes/src/shell/apes-self-dispatch.ts` — 55 Zeilen, shared `APES_GATED_SUBCOMMANDS` + `isApesSelfDispatch`

**Source (geändert):**
- `packages/apes/src/shell/grant-dispatch.ts` — import shared Helper, entferne inline Deklarationen, ersetze inline Check durch Helper-Call. Netto kürzer.
- `packages/apes/src/commands/run.ts` — neuer self-dispatch shortcut in `runShellMode` (15 Zeilen vor `tryAdapterModeFromShell`), env-strip in `execShellCommand` + `runAudienceMode` escapes-pipe (2 call sites)

**Tests (erweitert):**
- `packages/apes/test/commands-run-async.test.ts` — 11 neue Tests in zwei neuen describe Blöcken (~290 Zeilen)

**Changeset:**
- `.changeset/fix-one-shot-self-dispatch.md` — patch bump, vollständige Diagnose + Fix-Beschreibung

## Was 0.9.4 für openclaw konkret bedeutet

Der Flow der beim Live-Test hing:

```
apes$ date                                    # user command
→ Grant für 'date' created (korrekt)
→ openclaw polls via `ape-shell -c "apes grants status <id> --json"`
→ Vor 0.9.4: zweiter Grant für `bash -c apes grants status ...` created (CASCADE)
→ Ab 0.9.4: self-dispatch shortcut, direkter exec, kein Grant (FIXED)

User approves 'date' grant im Browser
→ openclaw sieht .status == "approved" via JSON polling
→ openclaw ruft `ape-shell -c "apes grants run <id>"`
→ self-dispatch shortcut, direkter exec
→ bash spawnt `apes grants run <id>` → findet den approved grant → verifyAndExecute → date output
→ openclaw liest output, meldet User "done"
```

Der komplette async-default Flow terminiert jetzt sauber ohne irgendwelche cascade- oder env-leak-Probleme auf dem one-shot Pfad.

## Nachfolge-Arbeit (out-of-scope für 0.9.4)

- **Workflow-File für `apes workflow show async-grant`**: der 0.9.3 agent-text referenziert diesen Command nicht mehr direkt (bewusst, weil das Workflow-File noch nicht existiert), aber für die lange-Form Agent-Protokoll-Docs wäre das ein natürlicher home. Nicht blocking, aber nice-to-have.

- **Der `extractPositionals` Bug aus run.ts:286-298**: weiterhin pre-existing, wartet auf einen separaten Fix-PR.

- **Shapes-Adapter Resolving von `apes grants status --json`**: Patrick hat in der IdP-UI beobachtet dass der Status-Grant als `bash -c apes grants status ...` angelegt wurde, nicht als shapes-level Operation. Das suggeriert dass der apes-Adapter `grants status --json` nicht sauber gegen eine definierte Operation matcht und zum Session-Grant-Pfad fällt. Nach 0.9.4 ist das aber irrelevant weil der self-dispatch shortcut das alles überspringt — der Adapter-Resolve wird gar nicht mehr angefragt für apes-self-calls.

## Lineage

`0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2 → 0.9.3 → 0.9.4`

Sechs Patch/Minor-Releases seit dem initial 0.8.0. Jeder einzelne ist aus echter Live-Observation entstanden, nicht aus pre-planning — und jeder einzelne hat eine Story wo ein Agent-consumer ein Problem aufgedeckt hat das im ruhigen Code-Review nicht sichtbar gewesen wäre.
