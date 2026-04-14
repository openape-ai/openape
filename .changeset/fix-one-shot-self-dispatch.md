---
'@openape/apes': patch
---

fix(apes): extend apes self-dispatch shortcut to `ape-shell -c` one-shot path + strip `APES_SHELL_WRAPPER` in `execShellCommand`

Behebt einen Rekursions-Loop den openclaw's Polling-Flow exposed: `ape-shell -c "apes grants status <id> --json"` kreiert jetzt keinen eigenen Grant mehr. Der 0.9.2 self-dispatch shortcut (der `apes <subcmd>` aus der interaktiven REPL exempted) wird auf den one-shot Pfad erweitert, und als defense-in-depth wird `APES_SHELL_WRAPPER` in `execShellCommand` aus der bash-Env gestrippt.

## Das Problem

Unter 0.9.2 kriegen Subcommands wie `apes grants run <id>` den self-dispatch shortcut im REPL (`shell/grant-dispatch.ts`) — sie bypassen den Grant-Flow weil sie als trusted shell-internal gelten. Aber der gleiche Check lebt **nicht** im one-shot Pfad (`commands/run.ts runShellMode`), den `ape-shell -c "<cmd>"` trifft nachdem `rewriteApeShellArgs` es zu `apes run --shell -- bash -c <cmd>` umschreibt.

Für openclaw's Polling-Flow heißt das konkret:

1. Openclaw spawnt `ape-shell -c "apes grants status <date-grant-id> --json"` als Child-Prozess
2. Wird rewritten zu `apes run --shell -- bash -c "apes grants status <date-grant-id> --json"`
3. `runShellMode` ruft `tryAdapterModeFromShell` — versucht den apes-Adapter zu laden
4. Entweder wird ein shapes-Grant für die spezifische `apes grants status` Operation kreiert, oder der adapter-resolve failed und es fällt durch zum Session-Grant path mit command `['bash', '-c', 'apes grants status ...']`
5. Openclaw sieht einen NEUEN Pending-Grant, wartet auf Approval
6. User approved den → wait loop wacht auf → `execShellCommand(['bash', '-c', 'apes grants status ...'])`
7. Bash spawnt `apes grants status ...` als Child, der aber `APES_SHELL_WRAPPER=1` aus dem inherited env sieht → `rewriteApeShellArgs` detected wrapper-mode → argv matched keine Regel → `action: 'error'` → "ape-shell: unsupported invocation" → exit 1
8. Oder: openclaw pollt weiter und jedes Poll-Call kreiert einen neuen Grant. Turtles all the way down.

Ergebnis: ein hängender Agent der mit jedem Poll-Call einen neuen Pending-Grant produziert und nie terminiert.

## Der Fix

### 1. Shared Module `packages/apes/src/shell/apes-self-dispatch.ts` (neu)

Extrahiert `APES_GATED_SUBCOMMANDS` (nur `run`, `fetch`, `mcp`) und den `isApesSelfDispatch(parsed)` Helper als single source of truth. Beide Dispatch-Pfade importieren jetzt denselben Check.

### 2. `shell/grant-dispatch.ts`

Ersetzt die inline-deklarierte Blocklist und den Check durch den Import + Helper-Call. Verhalten unverändert für die interaktive REPL — 27/27 bestehende `shell-grant-dispatch.test.ts` Tests bleiben grün.

### 3. `commands/run.ts runShellMode`

Neuer early-return BEVOR `tryAdapterModeFromShell`:

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

Wenn `ape-shell -c "apes grants status <id>"` reinkommt, entpackt der Check den bash-c-wrapper, parst die innere Zeile, erkennt dass es ein trusted `apes` self-call ist, und ruft `execShellCommand` direkt — kein Grant, keine Wait-Loop, kein Info-Block.

Das löst den Rekursions-Loop vollständig. Openclaw's Poll-Calls laufen jetzt durch als direct-exec ohne irgendeine Server-interaction.

### 4. `commands/run.ts execShellCommand` + `runAudienceMode` execFileSync

Beide `execFileSync` Call-Sites in `commands/run.ts` strippen jetzt `APES_SHELL_WRAPPER` aus dem env den sie an bash bzw. escapes weitergeben:

```ts
const { APES_SHELL_WRAPPER: _wrapperMarker, ...inheritedEnv } = process.env
execFileSync(command[0]!, command.slice(1), {
  stdio: 'inherit',
  env: inheritedEnv,
})
```

Das spiegelt den Fix aus `pty-bridge.ts` (0.8.0 Finding 4) auf dem one-shot Pfad. Ohne diesen Strip würde ein nested `apes grants status` im bash-child die "unsupported invocation" Error kriegen, weil es seinen Parent's `APES_SHELL_WRAPPER=1` inheritet und sich selbst als ape-shell-mode detected.

Defense in depth: selbst wenn jemand in Zukunft einen weiteren Call-Path einbaut der durch `execShellCommand` geht, bleibt der env-Strip als automatischer Schutz.

## Warum shared Module statt lokale Duplikation

Code-Duplication wäre auch 10 Zeilen pro Seite gewesen — klein, aber mit einem echten Risiko: wenn jemand später `APES_GATED_SUBCOMMANDS` in einem der beiden Files editiert und vergisst den anderen zu updaten, läuft ein inkonsistentes Gating-Modell. Der shared Module macht die Regel explizit single-source-of-truth, und der bestehende Tripwire-Test in `shell-grant-dispatch.test.ts` (der behavioral die exakte gating-set überprüft) greift weiterhin.

## Test-Manifest

**11 neue Tests** in `packages/apes/test/commands-run-async.test.ts` in zwei neuen describe-Blöcken:

### `runShellMode apes self-dispatch shortcut` (9 Tests)

1. `apes grants status <id>` bypasses grant flow, execs directly
2. `apes grants run <id>` bypasses (the bootstrap case)
3. `apes whoami` bypasses
4. `apes adapter install curl` bypasses
5. `apes run -- echo hi` STAYS gated (run is in blocklist)
6. `apes fetch https://example.com` STAYS gated
7. `apes mcp server` STAYS gated
8. `apes whoami | grep alice` (compound) does NOT self-dispatch
9. `curl example.com` (non-apes) does NOT self-dispatch

### `execShellCommand APES_SHELL_WRAPPER env strip` (2 Tests)

10. Strips `APES_SHELL_WRAPPER` from the bash child env when self-dispatching
11. Strips `APES_SHELL_WRAPPER` from the escapes pipe in `runAudienceMode --wait` mode

**Regression:**
- `shell-grant-dispatch.test.ts`: **27/27 green** (0.9.2 baseline preserved via shared module)
- `commands-run-async.test.ts`: **32/32 green** (21 baseline + 11 new)
- Full `@openape/apes` suite via turbo: **41 files / 477 green** (466 baseline from 0.9.3 + 11 new)

## Lineage

`0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2 → 0.9.3 → 0.9.4`
