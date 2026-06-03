# Die Änderungen in `@openape/apes@0.9.0`

Kontext: 0.9.0 ist die **erste Breaking-Change-Release** seit die ape-shell Wave in 0.8.0 gelandet ist. Der Plan kam aus `/Users/patrickhofmann/.claude/plans/flickering-percolating-origami.md` und macht den Grant-Approval-Wait in `apes run` / `ape-shell -c` non-blocking by default. Gleichzeitig kommt ein neuer Subcommand dazu, um approved Grants später nachträglich auszuführen.

## 1. `apes run` und `ape-shell -c` default auf async (BREAKING)

### Das Problem

Vor dieser Änderung blockierte jeder `apes run` / `ape-shell -c "<cmd>"` Aufruf, der einen neuen Grant benötigte, bis zu **5 Minuten** in einer 3-Sekunden-Polling-Schleife, während der User auf dem Handy approven sollte. Konkret existierten vier solche Wait-Sites in `packages/apes/src/commands/run.ts`:

| Site | Zeile (vorher) | Beschreibung |
|---|---|---|
| `runShellMode` inline poll | ~166-173 | `ape-shell` Session-Grant mit inline `while` + `apiFetch` |
| `tryAdapterModeFromShell` | ~260 | Shapes-Adapter-Grant via `waitForGrantStatus` Helper |
| `runAdapterMode` | ~355 | `apes run -- <cli> <args>` Pfad, gleicher Helper |
| `runAudienceMode` inline poll | ~400-410 | `apes run <audience> <action>` mit inline Loop + escapes pipe |

Für CI-Skripte war das OK. Für interaktive Nutzer nervig. Für AI-Agenten (openclaw, claude code, etc.) ein hartes Blocker-Pattern: der Agent stand still, bis der Mensch fertig war, und konnte nichts Anderes parallel erledigen.

### Die Änderung

Alle vier Sites bekommen dieselbe Refactor-Struktur:

```ts
if (shouldWaitForGrant(args)) {
  // ── Legacy blocking code (unverändert) ──
  const status = await waitForGrantStatus(idp, grant.id)
  if (status !== 'approved') throw new CliError(`Grant ${status}`)
  const token = await fetchGrantToken(idp, grant.id)
  await verifyAndExecute(token, resolved)
  return
}

// ── Neuer async default ──
printPendingGrantInfo(grant, idp)
return
```

Zwei neue Top-Level-Helper in `run.ts`:

```ts
function shouldWaitForGrant(args: Record<string, unknown>): boolean {
  return args.wait === true || process.env.APE_WAIT === '1'
}

function printPendingGrantInfo(grant: { id: string }, idp: string): void {
  consola.success(`Grant ${grant.id} erstellt`)
  console.log(`  Approve:   ${idp}/grant-approval?grant_id=${grant.id}`)
  console.log(`  Status:    apes grants status ${grant.id}`)
  console.log(`  Ausführen: apes grants run ${grant.id}`)
  console.log('')
  console.log('  Tipp: Im Browser "als timed/always approven" wählen, um das')
  console.log('  Kommando ohne erneuten Approval wiederzuverwenden.')
}
```

Neuer CLI-Flag auf `runCommand`:

```ts
'wait': {
  type: 'boolean',
  description: 'Block until grant is approved (default: async, print grant info and exit 0). Equivalent to APE_WAIT=1.',
  default: false,
},
```

### Was der User jetzt sieht

**Default (async):**

```
$ apes run -- curl https://example.com
ℹ Requesting grant for: Execute with elevated privileges: curl
✔ Grant 7b3a9e2c-14f7-4d58-8907-7126542f1689 erstellt
  Approve:   https://id.openape.at/grant-approval?grant_id=7b3a9e2c-14f7-4d58-8907-7126542f1689
  Status:    apes grants status 7b3a9e2c-14f7-4d58-8907-7126542f1689
  Ausführen: apes grants run 7b3a9e2c-14f7-4d58-8907-7126542f1689

  Tipp: Im Browser "als timed/always approven" wählen, um das
  Kommando ohne erneuten Approval wiederzuverwenden.

$ echo "exit: $?"
exit: 0
```

Exit 0, Shell ist sofort wieder frei. User approved im Browser, ruft dann `apes grants run <id>` um den tatsächlichen Command-Output zu bekommen.

**Mit `--wait` flag (Legacy blocking):**

```
$ apes run --wait -- curl https://example.com
ℹ Requesting grant for: Execute with elevated privileges: curl
ℹ Approve at: https://id.openape.at/grant-approval?grant_id=...
Waiting for approval...
ℹ Grant ... approved — continuing
<HTML from example.com>
```

**Mit `APE_WAIT=1` env var (für Fälle wo Flags nicht durchgereicht werden können):**

```
$ APE_WAIT=1 ape-shell -c "curl https://example.com"
# Identisches Blocking-Verhalten wie --wait
```

### Cache-Hits bleiben unverändert

Wenn bereits ein approved timed/always-Grant existiert (via `findExistingGrant` im Adapter-Pfad oder den Session-Grant-Lookup in `runShellMode`), führt die Erstinvocation direkt aus — kein Async-Zwischenschritt. Die Test-Suite hat das explizit abgedeckt als Regression-Guard.

### Interactive REPL bleibt komplett unberührt

Der `ape-shell`-REPL (ohne `-c`) hat eine eigene Verify-/Consume-Pipeline über `packages/apes/src/shell/orchestrator.ts` und `shell/grant-dispatch.ts`. Die wurde von dieser Änderung absichtlich nicht angefasst. Blocking-Wait mit dem in 0.8.0 ergänzten `Grant <id> approved — continuing` Ack bleibt REPL-Experience.

---

## 2. Neuer Subcommand: `apes grants run <id>`

### Was er macht

Führt einen bereits approved Grant aus. User-Flow:

```
$ apes run -- curl https://example.com
✔ Grant xyz erstellt ...
$ # User klickt Approve-URL im Browser
$ apes grants run xyz
<HTML from example.com>
```

### Wie er intern dispatcht

`packages/apes/src/commands/grants/run.ts` (neu):

1. `apiFetch` auf `${grantsUrl}/${id}` → holt den Grant.
2. **Status-Gate:**
   - `pending` → Error mit Approve-URL ("noch nicht approved")
   - `denied` / `revoked` → Error ("request a new one")
   - `used` → Error ("already been used — single-use grants cannot be re-executed")
   - `approved` → dispatch
3. **Dispatch nach Grant-Shape:**
   - **Shapes-Grant** (hat `authorization_details[].type === 'openape_cli'` oder `audience === 'shapes'`): ruft neuen Helper `resolveFromGrant(grant)` auf, der den Adapter lokal lädt und die `ResolvedCommand` re-konstruiert. Dann `fetchGrantToken` + `verifyAndExecute(token, resolved)`.
   - **Escapes-Grant** (`audience === 'escapes'`): holt `authz_jwt` via `POST /grants/<id>/token`, dann `execFileSync('escapes', ['--grant', jwt, '--', ...command])`.
   - **Legacy `ape-shell` Session-Grant** (`audience === 'ape-shell'`): klarer Error-Hinweis. Session-Grants waren single-use gegen eine spezifische `bash -c` Zeile — nicht re-executable über den Subcommand. Der User soll stattdessen den Original-Aufruf wiederholen, der dann via `findExistingGrant` timed/always-Grants wiederverwendet.
   - **Unknown audience** → Error.

### Neuer Helper `resolveFromGrant` in `shapes/grants.ts`

```ts
export async function resolveFromGrant(grant): Promise<ResolvedCommand> {
  const command = grant.request?.command
  if (!command || command.length === 0)
    throw new Error('Grant has no recorded command')

  const executable = command[0]
  const loaded = await loadOrInstallAdapter(executable)
  if (!loaded)
    throw new Error(`No adapter found for ${executable}`)

  const resolved = await resolveCommand(loaded, command)

  const recordedDigest = grant.request?.execution_context?.adapter_digest
  if (recordedDigest && resolved.digest !== recordedDigest)
    throw new Error(
      `Adapter digest mismatch: grant was created against ${recordedDigest}, local adapter is ${resolved.digest}. Reinstall or revert the adapter.`,
    )

  return resolved
}
```

Imports gehen direkt über `./parser.js` + `./shell-parser.js` — nicht über das `./index.js` Barrel — um potentielle Zirkular-Imports in `grants.ts` zu vermeiden.

### Registrierung in der CLI

`packages/apes/src/cli.ts`:

```ts
import { runGrantCommand } from './commands/grants/run'

const grantsCommand = defineCommand({
  // ...
  subCommands: {
    list: listCommand,
    // ...
    run: runGrantCommand,    // ← neu
    status: statusCommand,
    // ...
  },
})
```

---

## 3. Test-Fix für die `openape-free-idp` E2E-Suite

### Das Problem

Nach dem Push von PR #92 schlug der CI `validate` Job fehl: `apps/openape-free-idp/tests/shapes-e2e.test.ts` erwartete das alte blockierende Verhalten von `apes run`. Der Test spawnt `apes` als Child-Process, wartet bis es einen Grant kreiert hat, approved ihn via Management-Token und verifiziert dann dass `apes` das command tatsächlich ausführt. Mit dem neuen async default exitete `apes` sofort mit 0 nach dem Grant-Info-Print — bevor der Test den Grant approven konnte.

Fehlermeldung aus dem CI-Log:

```
FAIL tests/shapes-e2e.test.ts > free-idp + shapes end-to-end > runs shapes request through grant creation, approval, token fetch, consume, and wrapped CLI execution
Error: apes exited before creating a grant (code: 0)
```

### Der Fix

Minimale Änderung am Test-Spawn: `--wait` zum argv hinzufügen.

```ts
// apps/openape-free-idp/tests/shapes-e2e.test.ts:215
const apes = spawn('node', [apesCli, 'run', '--wait', '--idp', baseUrl, '--approval', 'once', '--', 'exo', 'dns', 'show', 'example.com'], {
  cwd: monorepoRoot,
  env: { ...process.env, HOME: sandboxDir, PATH: `${binDir}:${process.env.PATH}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

Plus ein erklärender Kommentar oben drüber, damit jemand der in 6 Monaten diesen Test liest versteht warum `--wait` da steht:

> Legacy blocking flow: `--wait` keeps the caller attached to the grant approval polling loop so this E2E can drive the approve → token-fetch → exec sequence end-to-end. Without `--wait`, `apes run` exits 0 after printing the async grant-info block (the new default as of 0.9.0).

Der Test ist jetzt explizit über das Blocking-Verhalten als Legacy-Pfad ausgewiesen — wenn irgendwann jemand den Test auf die neue async Semantik umbaut (mit Test für `apes grants run <id>` Flow), ist der Übergang klar.

---

## Test-Bilanz

| Test-File | Neu | Status |
|---|---|---|
| `packages/apes/test/commands-run-async.test.ts` (new) | 10 Tests über alle 4 Wait-Sites | ✓ all green |
| `packages/apes/test/commands-grants-run.test.ts` (new) | 8 Tests für den neuen Subcommand | ✓ all green |
| `apps/openape-free-idp/tests/shapes-e2e.test.ts` (updated) | — (fix der Regression) | ✓ all green |
| Full `@openape/apes` suite | **437 tests** | ✓ all green (429 baseline aus 0.8.0 + 18 neu) |
| CI `validate` auf main merge | — | ✓ 1m35s |

---

## Release-Pipeline

| Stage | Commit / Run | Result |
|---|---|---|
| PR #92 pushed → first CI | `dbc01ba` | ❌ E2E-Test gebrochen |
| E2E-Fix committed | `9ae2865` | — |
| PR #92 re-CI | `24363049151` | ✓ |
| Admin squash-merge PR #92 | `9ee98b7` | ✓ |
| Release workflow → updated changesets PR | `24363280689` | ✓ — opens PR #93 |
| Admin squash-merge PR #93 (version packages) | `32293e7` | ✓ |
| Release workflow → **npm publish** | `24363443955` | ✓ |
| `npm view @openape/apes version` | — | **0.9.0** ✓ |

---

## Migration für existierende User

**Für CI-Skripte** die auf den Exit-Code des tatsächlichen Kommandos warten:

```bash
# Vorher (implizit blocking):
apes run -- curl https://example.com

# Nachher Option 1 (explizites Flag):
apes run --wait -- curl https://example.com

# Nachher Option 2 (env var, für sshd/cron/git-hooks wo Flags nicht durchreichbar sind):
APE_WAIT=1 apes run -- curl https://example.com
```

**Für sshd/cron-Workflows** die `ape-shell` als Login-Shell fahren: `APE_WAIT=1` global in `.pam_environment`, systemd unit drop-in, oder direkt in der Cron-Expression.

**Für AI-Agenten** (openclaw, claude code, etc.) die async Semantik ist der neue happy path: der Agent kann die URL aus dem stdout parsen, dem User über seinen Notification-Channel weitergeben (oder via `APES_NOTIFY_PENDING_COMMAND` out-of-band), und nebenbei andere Aufgaben machen. Wenn der User approved hat, kann der Agent `apes grants run <id>` aufrufen um den tatsächlichen Output zu bekommen.

**Komposition mit 0.8.0's PR #84:** die async Semantik paart sich natürlich mit dem in 0.8.0 gelandeten `APES_NOTIFY_PENDING_COMMAND` (PR #84). Bei jedem Grant-Creation feuert sowohl der async Exit auf stdout als auch die konfigurierte out-of-band Notification (Telegram/osascript/beliebig). Der User merkt den Grant-Request auch wenn er gerade nicht aufs Terminal schaut.

---

## Pre-existing Bug flagged (nicht gefixt, out-of-scope)

`extractPositionals` in `packages/apes/src/commands/run.ts:286-298` behandelt jeden `--flag` als key-value-flag und skipped den nächsten positional:

```ts
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!
  if (arg === 'run') continue
  if (arg.startsWith('--')) {
    i++  // ← skipped the next token, auch wenn --flag boolean ist
    continue
  }
  positionals.push(arg)
}
```

**Konsequenz:** `apes run --wait escapes mount-nfs` routet _nicht_ zu Audience-Mode (erwartet 2 positionals `escapes mount-nfs`, kriegt aber nur 1 weil `escapes` als Wert für `--wait` konsumiert wird).

**Workarounds heute:**
- `--wait` nach den positionals stellen: `apes run escapes mount-nfs --wait`
- `APE_WAIT=1 apes run escapes mount-nfs` verwenden
- Für `apes run -- <cli> <args>` Form (mit `--` Delimiter) ist es egal, weil `extractPositionals` nicht zum Einsatz kommt

**Empfohlener Follow-up Fix:** `extractPositionals` sollte die citty args-Definition kennen (oder eine harte Liste von known-boolean-flags wie `--shell`, `--wait`, `--debug`) und nur bei String-typed flags das nächste Token skippen. Verdient einen separaten kleinen PR, ist aber im Scope dieses Plans nicht drin.

---

## Was nach 0.9.0 auf der Liste ist

Aus der Design-Diskussion heute:

1. **Interactive REPL Pending-Grant Recovery** (Nachfolge-Feature zum Plan): Ctrl-C in der REPL cancelt die Wait-Loop gracefully, `:pending` Meta-Command listet Pending-Grants der aktuellen Session, `:run <id>` als REPL-interne Variante des neuen `apes grants run <id>`. Idee kam aus der Diskussion "soll man den Modus in der REPL interaktiv wechseln können" — Antwort war "nein, kein Toggle, aber die Recovery-Hebel sind trotzdem wertvoll".

2. **`extractPositionals` Fix** wie oben.

3. **Token-Rotation Tooling**: wenn NPM_TOKEN wieder expired ist, brauchen wir einen schnelleren Update-Flow als "Secret manuell im GitHub UI setzen + Re-run triggern". Idee für später: ein dedicated Admin-Skill oder ein npm-token-validate hook der PRs früh flagged.

4. **Release-Notes-Format**: das Free-IdP free-idp erwartet dass der User beim ersten `apes run` Aufruf den "als timed/always approven" Tipp lesen kann — die Textzeile ist jetzt im `printPendingGrantInfo` Helper, aber vielleicht sollte sie nur beim _ersten_ Aufruf feuern und danach optional sein (nervig wenn man 20 verschiedene Commands in Folge approved).

---

## Files-Manifest

### In `@openape/apes` (packages/apes/):

**Source (produktiv):**

- `src/commands/run.ts` — editiert (+108, -30). Neue `--wait` arg, `shouldWaitForGrant` + `printPendingGrantInfo` helpers, Refactoring aller 4 Wait-Sites.
- `src/commands/grants/run.ts` — neu angelegt (109 lines). `runGrantCommand` mit full dispatch logic.
- `src/shapes/grants.ts` — editiert (+41). Neuer `resolveFromGrant` Helper + benötigte Imports.
- `src/shapes/index.ts` — editiert (+1). Export `resolveFromGrant` aus dem Barrel.
- `src/cli.ts` — editiert (+2). Import + Registrierung von `runGrantCommand` in `grantsCommand.subCommands`.

**Tests (neu):**

- `test/commands-run-async.test.ts` — neu (335 lines). 10 Tests über alle 4 Wait-Sites × (async default / --wait flag / APE_WAIT env / cache hit regression).
- `test/commands-grants-run.test.ts` — neu (207 lines). 8 Tests für den neuen Subcommand (shapes / escapes / ape-shell legacy / pending / denied / used / resolve-failure / unknown audience).

### In `apps/openape-free-idp` (E2E-Regression fix):

- `tests/shapes-e2e.test.ts` — editiert (+5, -1). `--wait` an den `apes` spawn args hinzugefügt + Kommentar warum.

### Changeset:

- `.changeset/feat-grant-flow-async-default.md` — neu (76 lines). Minor bump mit prominent BREAKING CHANGE Note + vollständige Migration-Anleitung. Wird beim Version-Packages-Merge automatisch in `packages/apes/CHANGELOG.md` gefoldet und aus `.changeset/` entfernt.

### Ergebnis in Git:

- Branch `feat/grant-flow-async-default` mit 4 Commits:
  1. `5343cfd` feat(apes): async default for apes run with --wait / APE_WAIT override
  2. `0d6db7d` feat(apes): add apes grants run <id> subcommand
  3. `dbc01ba` chore(apes): changeset for async-default grant flow
  4. `9ae2865` test(free-idp): use --wait in shapes-e2e for legacy blocking flow
- Squash-merged als `9ee98b7` in main via PR #92.
- Version-Packages-PR #93 hat die Version auf 0.9.0 gebumped und das CHANGELOG aktualisiert, squash-merged als `32293e7`.
- Release-Workflow hat daraus `@openape/apes@0.9.0` publisht. Live auf npm seit 2026-04-13T19:47:29Z.

### Cleanup danach:

- Worktree `openape-monorepo.worktrees/openape-monorepo-grant-async` force-removed (nur wegen Nuxt-prepare-generierter dirty files in `modules/nuxt-auth-idp/src/runtime/pages/*.vue`, nicht wegen eigener Änderungen).
- Branch `feat/grant-flow-async-default` lokal gelöscht.
- Main-Checkout + die beiden pre-existing anderen Worktrees (`docs-issue-81`, `fix-issue-64-missing-drizzle-tables`) unberührt.
- Kein lose Temp-File übrig.
