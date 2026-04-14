---
'@openape/apes': patch
---

feat(apes): `apes grants run <id> --wait` + simplified agent text block

Neuer `--wait` flag auf `apes grants run <id>` der CLI-seitig auf Approval wartet, plus refactored agent-mode text block der den neuen Flow empfiehlt. Schließt den letzten Gap aus dem 0.10.0 live-test: openclaw hat exit 75 + text korrekt gelesen, aber sein turn-based Execution-Modell konnte den "poll every 10s" Loop nicht durchhalten weil jede User-Nachricht den polling-turn unterbrochen hat.

## Das Problem

Nach 0.10.0 hat openclaw den async-grant-Flow das erste Mal überhaupt **gelesen und befolgt**. Der strukturelle Attention-Anker (exit code 75 → `failed` tool-result status) hat gewirkt. Aber dann kam der zweite Layer:

openclaw hat 2x gepollt, dann aufgehört. Ehrliche Selbst-Diagnose vom Agent:

> *"Ich habe aufgehört zu pollen weil ich auf deine Nachricht reagiert habe statt stur weiterzupollen. Das war falsch — die Anweisung sagt 5 Minuten warten, egal was. Ich lerne es."*

Der Grund ist architektonisch: **Chat-basierte Agents sind turn-based**. Ein Turn = ein Request/Response. Zwischen Turns gibt es keinen persistenten Background-Worker der Polling weiterlaufen lassen kann. Der 0.9.3/0.10.0 agent-text hat "poll every 10s for 5 minutes" verlangt, aber das setzt einen Persistent-Background-Worker voraus den Chat-Agents nicht haben.

Jede neue User-Nachricht unterbricht den Agent, er reagiert auf die Nachricht statt zu pollen, der pending grant bleibt hängen.

## Der Fix — Polling-Orchestrierung von Agent-Seite auf CLI-Seite verlagern

Patrick's Vorschlag war die richtige strukturelle Antwort: *"Inform User about the open Grant and retry with `apes grants run <id> --wait` until User approved."*

Statt dass der Agent die Polling-Schleife selbst orchestriert, ruft er einmal `apes grants run <id> --wait` und die CLI blockiert intern bis approved/denied/timeout. Das passt zu **jedem** Execution-Modell:

- **Chat-Agents (turn-based)**: ein einzelner Tool-Call der blockt, openclaw's `yieldMs` + `notifyOnExit` Mechanik resumed den Agent wenn das Kommando fertig ist
- **Persistent-Background-Worker**: ein single call der bis zur Auflösung blockt, keine Loop-State-Machine nötig
- **Script-Konsumenten**: ein single call, dann `$?` prüfen — der sauberste CI-Workflow

Der Agent muss keinen Polling-Loop selber bauen, keinen Zustand zwischen Turns halten, und muss auch nicht mit "ich wurde durch User-Input unterbrochen" zurechtkommen.

## Die Implementation

### 1. Neuer shared Module `packages/apes/src/grant-poll.ts`

Extrahiert die Poll-Config-Getter (`getPollIntervalSeconds`, `getPollMaxMinutes`) die bisher in `commands/run.ts` lokal definiert waren, plus einen neuen `pollGrantUntilResolved(idp, grantId)` Helper der das Polling macht:

```ts
export type PollOutcome =
  | { kind: 'approved' }
  | { kind: 'terminal', status: 'denied' | 'revoked' | 'used' }
  | { kind: 'timeout' }

export async function pollGrantUntilResolved(idp: string, grantId: string): Promise<PollOutcome> {
  const intervalMs = getPollIntervalSeconds() * 1000
  const maxMs = getPollMaxMinutes() * 60_000
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const grant = await apiFetch<{ status: string }>(`${grantsEndpoint}/${grantId}`)
    if (grant.status === 'approved') return { kind: 'approved' }
    if (grant.status === 'denied' || grant.status === 'revoked' || grant.status === 'used')
      return { kind: 'terminal', status: grant.status }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return { kind: 'timeout' }
}
```

Single source of truth — beide Code-Pfade (`commands/run.ts` für die initiale Grant-Creation wait loops und `commands/grants/run.ts` für die CLI-side wait in `--wait` Mode) benutzen dieselben Knobs.

### 2. `commands/grants/run.ts` — neuer `--wait` flag

```ts
args: {
  id: { type: 'positional', required: true },
  'escapes-path': { type: 'string', default: 'escapes' },
  wait: {
    type: 'boolean',
    description: 'If the grant is pending, block and poll until approved',
    default: false,
  },
}
```

Wenn status pending AND `args.wait === true`:

```ts
if (grant.status === 'pending') {
  if (!args.wait) {
    throw new CliError(`Grant ${grant.id} is still pending. Approve at: ...`)
  }
  const outcome = await pollGrantUntilResolved(idp, grant.id)
  if (outcome.kind === 'timeout') throw new CliError(`... timed out after ${maxMin} minutes ...`)
  if (outcome.kind === 'terminal') throw new CliError(`Grant ... resolved to ${outcome.status}`)
  // outcome.kind === 'approved' — re-fetch grant for up-to-date shape
  grant = await apiFetch<GrantDetail>(`${grantsUrl}/${args.id}`)
  consola.info(`Grant ${grant.id} approved — continuing`)
}
```

Wenn pending ohne `--wait`: bestehender Error wie bisher (regression guard).

Nach dem pending-handler fällt der Flow in den bestehenden dispatch-Code durch — shapes grant → verifyAndExecute, escapes audience → escapes pipe, etc. Alle existierenden dispatch paths unverändert.

### 3. `commands/run.ts printPendingGrantInfo` — neuer agent-mode text

Der "For agents:" Block wird komplett umformuliert von "poll every Xs" zu "call `apes grants run <id> --wait`":

```
For agents:
  1. Tell the user about the pending grant and the approve URL above.
  2. Run `apes grants run <id> --wait`. This blocks up to 5 minutes
     until the user approves (or denies/timeout) and then executes
     the command in a single step. The CLI handles the polling loop
     internally — you do not need to poll the status yourself.
  3. Exit 0 means approved + executed; stdout is the command output.
     Exit 75 (pending) only appears if you accidentally call this
     without --wait. Any other non-zero exit means denied, revoked,
     used, or timeout — report the reason to the user.

Note: exit code 75 (EX_TEMPFAIL) from this command means "pending,
retry later" — do not abort your workflow, follow the steps above.
```

Der Text ist jetzt execution-model-agnostisch — sowohl turn-based als auch persistent-background-Konsumenten können den single-call-Ansatz nahtlos ausführen. Plus der explizite Hinweis zu exit code 75 als "not an error" adressiert den edge case wo ein Agent-Framework den exit code als "task failed, abort" missinterpretiert.

Das `APES_GRANT_POLL_INTERVAL` Knob ist jetzt ein **internes CLI-Detail** und wird nicht mehr im agent-text erwähnt — der Agent ruft einfach `--wait`, die CLI entscheidet wie sie pollt. Nur `APES_GRANT_POLL_MAX_MINUTES` bleibt im Text sichtbar weil es den User informiert wie lange er Zeit hat zu approven.

### 4. openclaw's yield-and-resume Mechanik als perfekter Fit

Die Flow-Dynamik für openclaw wird:

1. User: *"Führe `date` aus"*
2. Agent ruft `ape-shell -c "date"` → exit 75 + grant info
3. Agent liest "For agents: tell user + run `apes grants run xyz --wait`"
4. Agent: *"Grant xyz erstellt. Bitte bestätigen: <url>. Ich warte bis approved."*
5. Agent ruft `apes grants run xyz --wait` via exec tool
6. openclaw's exec tool spawnt den child, wartet `yieldMs` (default 10s), yieldet zum Agent mit *"Command still running (session S)"*
7. Agent endet seinen turn (z.B. *"warte noch auf approval, melde mich wenn's durch ist"*)
8. Background-child pollt weiter mit `pollGrantUntilResolved`
9. User approved im Browser
10. Background-child sieht `approved`, fetcht token, führt `date` aus, schreibt Output nach session, exited 0
11. openclaw's `notifyOnExit` fires → `requestHeartbeatNow({reason: "exec-event"})` → Agent wacht auf
12. Agent liest session output, meldet `Tue Apr 14 21:11:38 CEST 2026`

Das ist genau das Pattern das die Finding 5 "Silent-Agent-Block" aus dem ursprünglichen 0.8.0 plan addressed. Wenn openclaw's notifyOnExit funktioniert, terminiert der Flow ohne User-Nachstupsen. Wenn es nicht funktioniert, reicht ein User-Message als Re-Trigger (wie im aktuellen Screenshot-Fall).

## Test-Manifest

### Neue Tests in `commands-grants-run.test.ts` (7 Tests)

1. **Regression guard**: ohne `--wait` bleibt pending → error Verhalten
2. `--wait` + pending → poll → approved → dispatch shapes grant
3. `--wait` + pending → poll → denied → CliError
4. `--wait` + pending → poll → revoked → CliError
5. `--wait` + pending → poll → timeout → CliError mit max minutes
6. `--wait` + already-approved → dispatch sofort, kein poll
7. `--wait` + pending → approved → escapes audience pipe

### Updated Tests in `commands-run-async.test.ts`

8 existierende "async info block audience mode" Tests geupdated: die alten `expect(out).toContain('every 10s')` Assertions werden durch Assertions auf die neue Text-Struktur ersetzt (`For agents:`, `apes grants run X --wait`, `exit code 75`, `EX_TEMPFAIL`). Zusätzliche Regression-Guard: `APES_GRANT_POLL_INTERVAL` darf NICHT mehr in den agent-text leaken (da es jetzt internes CLI-Detail ist).

### Regression

- `shell-grant-dispatch.test.ts`: 27/27 green (unberührt)
- `commands-run-async.test.ts`: 43/43 green
- `commands-grants-run.test.ts`: 15/15 green (8 baseline + 7 neu)
- Full `@openape/apes` suite via turbo: **41 files / 495 green** (488 baseline aus 0.10.0 + 7 neu)

## Lineage

`0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2 → 0.9.3 → 0.9.4 → 0.10.0 → 0.10.1`
