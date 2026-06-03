# Die Änderungen in `@openape/apes@0.10.1`

Kontext: 0.10.1 schließt die letzte Lücke der turn-basierten Agent-Ausführung. 0.10.0 hat den `exit 75` Attention-Anker eingebaut, sodass openclaw den async-Flow nicht mehr als "done" missinterpretiert. Aber die nächste Live-Observation hat gezeigt: **auch ein Agent, der den async-Flow korrekt erkennt, hält ein mehrminütiges Polling-Loop nicht durch** — weil turn-basierte Chat-Agents nach jeder User-Message ihren Zustand verlieren.

Die Lösung: **Orchestrierung vom Agent in die CLI verschieben.** Statt dem Agent zu sagen "poll alle 5s bis 5min", gibst du ihm einen einzigen blocking Tool-Call der intern pollt und erst zurückkehrt wenn der Grant approved (oder abgelehnt, oder getimeouted) ist. Das ist `apes grants run <id> --wait` — und es lässt sich sauber mit openclaw's `yieldMs` + `notifyOnExit` Mechanik kombinieren.

## Das Problem — turn-basiertes Polling scheitert

Nach 0.10.0 hat Patrick den Flow wieder live getestet. openclaw hat diesmal:

1. `ape-shell -c "date"` aufgerufen → exit 75 → korrekt als "pending" erkannt ✓
2. Die Polling-Anweisung aus dem Text-Block gelesen → 2× gepollt ✓
3. **Nach dem zweiten Poll aufgehört.** Der Grant war noch pending. openclaw hat Patrick die Pending-URL geschickt und auf eine Antwort gewartet.

Als Patrick nachgefragt hat, kam die klare Selbstdiagnose:

> *"Ich habe aufgehört zu pollen weil ich auf deine Nachricht reagiert habe statt stur weiterzupollen. Das war falsch — die Anweisung sagt 5 Minuten warten, egal was."*

Der Bug ist **nicht** im Text, nicht im exit code, nicht in openclaw — es ist ein fundamentales Architektur-Mismatch: **Turn-basierte Chat-Agents haben keinen persistenten Background-Worker.** Jede User-Message unterbricht natürlich den Execution-Flow. Den Agent zu bitten "ignoriere User-Messages 5 Minuten lang und polle stur weiter" ist ein Anti-Pattern das gegen die gesamte Chat-UX arbeitet.

## Patricks Fix — Orchestrierung verschieben

Patrick's Vorschlag war präzise:

> *"Inform User about the open Grant and retry with `apes grants run <id> --wait` until User approved."*

Die Idee: der Agent macht **einen** Tool-Call der blockt. Während der Call läuft, kann der Agent den User parallel informieren. Intern pollt die CLI. Der Agent muss nicht "warten" — er muss nur auf das Ergebnis des Tool-Calls warten, und das ist genau das Mental-Model für das Chat-Agents gebaut sind.

openclaw's exec-runtime hat dafür bereits den perfekten Hebel: `yieldMs` + `notifyOnExit`. Ein Command kann nach `yieldMs` Millisekunden "yielden" (Turn zurückgeben, im Background weiterlaufen), und `notifyOnExit` triggert einen neuen Turn sobald der Prozess terminiert. Das heißt der Flow wird:

```
turn 1: openclaw → apes grants run <id> --wait (yieldMs 2000)
        ← yielded, grant-run läuft im Background
        openclaw sagt dem User: "Bitte approven: <link>"
turn 2: (automatisch getriggert durch notifyOnExit)
        ← grant approved, command durchgelaufen, output da
        openclaw sagt dem User: "Fertig: <output>"
```

Kein Polling-Loop im Agent. Keine imperative Anweisung die ignoriert werden könnte. Nur ein blocking Call und eine Event-Notification.

## Die Implementierung

### Neues Modul `packages/apes/src/grant-poll.ts`

Die Poll-Logik die vorher lokal in `commands/run.ts` lebte ist rausgezogen in ein shared Modul mit einem sauberen Result-Type:

```ts
export type PollOutcome =
  | { kind: 'approved' }
  | { kind: 'terminal'; status: 'denied' | 'revoked' | 'used' }
  | { kind: 'timeout' }

export async function pollGrantUntilResolved(
  idp: string,
  grantId: string
): Promise<PollOutcome> {
  const intervalMs = getPollIntervalSeconds() * 1000
  const maxMs = getPollMaxMinutes() * 60_000
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const grant = await apiFetch<{ status: string }>(
      `${getGrantsEndpoint(idp)}/${grantId}`
    )
    if (grant.status === 'approved') return { kind: 'approved' }
    if (
      grant.status === 'denied' ||
      grant.status === 'revoked' ||
      grant.status === 'used'
    ) {
      return { kind: 'terminal', status: grant.status }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return { kind: 'timeout' }
}
```

`getPollIntervalSeconds()` und `getPollMaxMinutes()` lesen aus `APES_GRANT_POLL_INTERVAL_SECONDS` / `APES_GRANT_POLL_MAX_MINUTES` mit Config-Fallback (`grant_poll_interval_seconds`, `grant_poll_max_minutes`) und sinnvollen Defaults (5s / 5min). Dieselben Helper werden jetzt an **zwei** Call-Sites benutzt: `apes run` (legacy Agent-Polling, weiterhin unterstützt für nicht-async Flows) und `apes grants run --wait` (der neue Haupt-Pfad).

### Neuer `--wait` Flag auf `apes grants run <id>`

`commands/grants/run.ts` bekommt ein neues Argument und eine neue Code-Pfad:

```ts
args: {
  id: { type: 'positional', required: true },
  wait: {
    type: 'boolean',
    default: false,
    description: 'Block until the grant is approved (or timeout).',
  },
},
```

Die Dispatch-Logik checkt den Status des Grants. Wenn approved → wie bisher ausführen. Wenn pending:

```ts
if (grant.status === 'pending') {
  if (!args.wait) {
    throw new CliError(
      `Grant ${grant.id} is still pending. Approve it at ${approvalUrl}, ` +
      `then rerun with --wait to block until approved.`
    )
  }
  consola.info(`Waiting for grant ${grant.id} to be approved...`)
  const outcome = await pollGrantUntilResolved(idp, grant.id)
  if (outcome.kind === 'timeout') {
    throw new CliError(
      `Grant ${grant.id} timed out after ${getPollMaxMinutes()} minutes. ` +
      `Rerun with --wait to continue polling.`
    )
  }
  if (outcome.kind === 'terminal') {
    throw new CliError(
      `Grant ${grant.id} resolved to ${outcome.status}. Request a new one.`
    )
  }
  grant = await apiFetch<GrantDetail>(`${grantsUrl}/${args.id}`)
  consola.info(`Grant ${grant.id} approved — continuing`)
}
```

Drei saubere Exit-Pfade:

1. **approved** → Status-Refresh, dann execute (audience-spezifisch: shapes/escapes/ape-shell)
2. **terminal** (denied/revoked/used) → `CliError` mit klarem "Request a new one" Hinweis
3. **timeout** → `CliError` mit "Rerun with --wait" Hinweis

Ohne `--wait` kommt der alte harte Error (`"Grant ... is still pending ..."`), sodass der Flag strikt additiv ist und keine Regressions-Gefahr für bestehende Scripts birgt.

### Rewritten Agent-Text in `printPendingGrantInfo`

Der große Text-Block aus 0.9.3 und 0.10.0 (exit 75 + manuelle Polling-Anweisungen) wird durch eine deutlich kompaktere Instruktion ersetzt die **nur noch auf einen einzigen Tool-Call verweist**:

```
┌─────────────────────────────────────────────────────────────┐
│ Grant pending. Approve here:                                │
│   <approval-url>                                            │
│                                                             │
│ For agents: inform the user about the pending grant,        │
│ then run ONE blocking command:                              │
│                                                             │
│   apes grants run <grant-id> --wait                         │
│                                                             │
│ This blocks internally until the grant is approved.         │
│ No manual polling required.                                 │
└─────────────────────────────────────────────────────────────┘
```

Der Text ist:

- **Kürzer** — keine Poll-Interval-Spec mehr, keine Retry-Loop-Pseudocode, kein 5-Minuten-Limit im Text (das lebt jetzt in der CLI).
- **Deklarativ** — "run ONE blocking command" statt "poll alle 5s bis approved".
- **Nicht-interaktiv nutzbar** — der Agent kann den `<grant-id>` direkt aus dem maschinenlesbaren Header extrahieren der schon seit 0.9.3 drüber steht (`APES_GRANT_ID=...`).

### Tests

`test/commands-run-async.test.ts`: **8 text assertions aktualisiert** — überall wo der alte Polling-Instructions-Text erwartet wurde, steht jetzt der `apes grants run <id> --wait` Text. Exit-Code-Assertions und Grant-Creation-Checks bleiben unverändert, das ist reiner Text-Refactor.

`test/commands-grants-run.test.ts`: **7 neue Tests** für den `--wait` Flag:

1. **Regression guard** — ohne `--wait`, pending → CliError wie bisher
2. **pending → approved** — Mock pollt 1× pending, dann approved → execute durchläuft
3. **denied** → CliError "resolved to denied"
4. **revoked** → CliError "resolved to revoked"
5. **timeout** → CliError "timed out after 5 minutes"
6. **already approved** → kein poll call, direkt execute (sanity check dass `--wait` nicht den happy path bricht)
7. **escapes audience pipe** — `--wait` funktioniert auch für escapes-Grants, nicht nur shapes/ape-shell

Das `grant-poll.js` Modul wird gemockt via `vi.mock('../src/grant-poll.js')` sodass die Tests keine echten Timer brauchen und deterministisch laufen.

**Stand:** 50 passing, full suite grün (`pnpm turbo run test --filter '@openape/apes'`).

## Das Zusammenspiel mit openclaw

Der Witz ist dass wir auf **openclaw-Seite gar nichts ändern müssen.** `apes grants run <id> --wait` ist aus openclaws Sicht ein gewöhnlicher Bash-Command. Die bereits vorhandenen Mechanismen greifen automatisch:

- **`yieldMs`**: openclaws exec-runtime erlaubt Commands nach einer konfigurierbaren Delay "ins Background" zu yielden. Der Agent-Turn endet, der Prozess läuft weiter.
- **`notifyOnExit`**: sobald der Background-Prozess terminiert, triggert das einen neuen Agent-Turn mit dem finalen exit code und dem gesamten output.
- **exit 0 vs exit !=0**: `apes grants run --wait` folgt den Standard-Shell-Conventions. Approved + execute erfolgreich → exit 0 (`textResult`). Denied/revoked/timeout → exit 1 (`failedTextResult`).

Das heißt: **der Agent braucht keine apes-spezifische Logik**. Keine speziellen Instruktionen, keine Polling-Loops, keine Exit-Code-Interpretation jenseits von "0 = gut, nicht-0 = schlecht". Genau so sollte ein CLI-Tool sich in einen Agent einfügen.

## Die Release-Pipeline

1. Worktree `fix/grant-run-wait-flag` aus `origin/main`
2. Subagent für die Implementation (grant-poll.ts extraction + --wait flag + tests)
3. Subagent für den Text-Rewrite in `printPendingGrantInfo` + die 8 test assertions
4. Changeset `patch` (neuer Flag ist additiv, kein breaking change)
5. Commit `feat(apes): add --wait flag to grants run for CLI-side grant polling`
6. PR #104 → grün → merge `180d26f`
7. Version-packages PR #105 (`@openape/apes@0.10.1`) → merge `c242768`
8. Release workflow → `@openape/apes@0.10.1` auf npm
9. Local re-install an allen vier Pfaden:
   - `/usr/local/bin/apes` → 0.10.1 ✓
   - `/usr/local/bin/ape-shell` → 0.10.1 ✓
   - `/opt/homebrew/bin/apes` → 0.10.1 ✓
   - `/opt/homebrew/bin/ape-shell` → 0.10.1 ✓

## Was 0.10.1 nicht tut

- **Kein Ersatz für 0.10.0.** Der `exit 75` Attention-Anker bleibt. Der async-default-Flow von 0.9.4 bleibt. `--wait` ist additiv zur existierenden Architektur.
- **Keine Änderung an openclaw.** openclaw bleibt read-only. Die ganze Lösung lebt in der apes-CLI.
- **Kein auto-`--wait`.** Der Flag ist explizit opt-in. Der Agent (oder User) entscheidet wann blocking Polling sinnvoll ist. Scripts die das alte Verhalten brauchen (pending → hard fail) funktionieren unverändert.
- **Keine Änderung am REPL-Flow.** ape-shell interaktiv benutzt weiterhin session-grants mit dem existierenden Approval-Flow. `--wait` ist spezifisch für den `apes run`-aus-Agent-Heraus Use-Case.

## Lineage

```
0.7.2  baseline (session start)
0.8.0  Findings 1-7: REPL-Meta, health-Command, env-Leak-Fix, ack-Logs
0.9.0  Async-default + --wait flag auf `apes run` (opt-in blocking)
0.9.1  grants status display bugs (Type/Requester/Owner/Decided-at)
0.9.2  self-dispatch shortcut (REPL + one-shot)
0.9.3  text-first agent instructions + USER=agent|human mode
0.9.4  self-dispatch shared module + env strip + escapes pipe
0.10.0 BREAKING: async default exit code → 75 (EX_TEMPFAIL)
0.10.1 apes grants run --wait → shift poll orchestration CLI-side
```

0.10.1 ist der Abschluss der Session. Die Live-Observation mit openclaw um 22:01 zeigt den kompletten Happy-Path:

1. `date` aus openclaw → pending grant erstellt, exit 75, `<grant-id>` im Header
2. openclaw erkennt async → schickt Patrick die Approval-URL
3. openclaw macht `apes grants run <id> --wait` als **einzigen** Background-Tool-Call
4. Patrick approved im Browser
5. Poll-Loop in der CLI fängt den State-Wechsel, Command läuft durch, exit 0
6. openclaw bekommt die notification, sagt Patrick: *"Mit `--wait` blockiert der Befehl intern bis du bestätigst — kein manuelles Polling mehr nötig!"*

Genau das war das Ziel. Turn-basierter Agent, persistent-blockierender CLI-Call, null Polling-Loops im Agent-Code. Fertig.
