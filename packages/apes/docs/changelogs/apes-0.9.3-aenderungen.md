# Die Änderungen in `@openape/apes@0.9.3`

Kontext: 0.9.3 schließt einen echten UX-Gap den 0.9.0's async-default geöffnet hat. Der Grant-Info-Block der bei Pending-Grants gedruckt wird sagt dem konsumierenden AI-Agent jetzt explicit was er als nächstes tun soll — poll interval, max wait, behavior bei approved / denied / timeout. Humans können opt-in auf einen kurzen freundlichen Block umschalten via `APES_USER=human`.

## Das Problem

Nach 0.9.0 war der Output von `apes run -- <cmd>` (oder `ape-shell -c "<cmd>"`) nach Grant-Creation so:

```
✔ Grant <uuid> erstellt
  Approve:   https://id.openape.at/grant-approval?grant_id=<uuid>
  Status:    apes grants status <uuid>
  Ausführen: apes grants run <uuid>

  Tipp: Im Browser "als timed/always approven" wählen...
```

Der Text war für Humans am Terminal designed: Ein Mensch liest, approved im Browser, kommt zurück und tippt `apes grants run <uuid>`. Für einen AI-Agent war dieser Text komplett unsichtbar in seiner Wirkung:

1. Der Agent sah `✔` + exit 0 und meldete dem User "done" obwohl nichts ausgeführt wurde
2. Keine Instruktion im Text *was* mit der Grant-ID zu tun ist
3. Keine Info wie lange zu warten ist
4. Kein Handling-Hinweis für denied / revoked / timeout

Der async-Flow funktionierte am besten mit Humans die das Protokoll verstanden, und schlecht bis gar nicht mit Agents — genau umgekehrt zur eigentlichen Zielgruppe des async-Flows (der ist vor allem für AI-Agents gedacht, damit sie nicht 5 Minuten in einer Wait-Loop festhängen).

## Was 0.9.3 geändert hat

### 1. Zwei Output-Modi — agent (default) und human (opt-in)

Die Funktion `printPendingGrantInfo` in `packages/apes/src/commands/run.ts` wurde umgeschrieben. Sie bestimmt vor jedem Print den User-Mode via `getUserMode()` und emittiert entsprechend.

**Default — agent mode:**

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

Die Agent-Instruktionen sind imperative English Sätze — "poll", "run", "stop", "report", "notify". Jeder der drei terminalen States ist explicit gehandled:

| Status | Action |
|---|---|
| `approved` | Run `apes grants run <id>` to execute |
| `denied` / `revoked` | Stop, report to user |
| Still `pending` after 5 min | Stop, notify user that approval has not happened |

Der Agent braucht keine externe Skill-Definition um diesen Protokoll zu verstehen — der Output ist selbst die Spec.

**Opt-in — human mode:**

```
✔ Grant e887a7e3-... created — awaiting your approval
  Approve in browser:  https://id.openape.at/grant-approval?grant_id=e887a7e3-...
  Check status:        apes grants status e887a7e3-...
  Run after approval:  apes grants run e887a7e3-...

  Tip: Approve as "timed" or "always" in the browser to reuse
  this grant without re-approval on the next invocation.
```

Kürzer, freundlicher, keine Polling-Instruktionen. Wird aktiviert via:

```bash
export APES_USER=human           # Env-var (höchste Prio)
# oder
echo 'export APES_USER=human' >> ~/.zshrc    # persistent
# oder
# in ~/.config/apes/config.toml:
[defaults]
user = "human"
```

### 2. Konfigurierbares Polling-Policy

Die hartkodierten `10s` und `5 minutes` sind jetzt drei Ebenen konfigurierbar (Env > Config > Default):

**Env vars (höchste Priorität):**

```bash
APES_USER=agent|human              # audience mode
APES_GRANT_POLL_INTERVAL=30        # seconds between polls
APES_GRANT_POLL_MAX_MINUTES=10     # max total wait
```

**Config fallback** in `~/.config/apes/config.toml`:

```toml
[defaults]
user = "agent"                       # or "human"
grant_poll_interval_seconds = "30"   # stored as string due to hand-rolled TOML parser
grant_poll_max_minutes = "10"
```

**Baked-in defaults** wenn weder env noch config gesetzt:
- `user = "agent"`
- `grant_poll_interval_seconds = 10`
- `grant_poll_max_minutes = 5`

Die Werte fließen direkt in den gedruckten Text, damit der Agent immer die tatsächlich aktive Policy sieht — nicht eine hardcoded Zahl die nicht zur Laufzeit stimmt.

**Bogus values werden graceful ignored:**

- `APES_GRANT_POLL_INTERVAL=not-a-number` → ignored, fällt zurück zu config oder default
- `APES_GRANT_POLL_MAX_MINUTES=-5` → negative value rejected, fällt zurück
- `APES_USER=random-garbage` → ignored, fällt zurück zu "agent" default

### 3. Warum default = agent

Eine bewusste Design-Entscheidung. Zwei Argumentationslinien:

**Contra-agent-default:** "Der Output ist jetzt länger und verbose. Humans am Terminal lesen 5 extra Zeilen Text die sie nicht brauchen."

**Pro-agent-default (gewonnen):**
1. **Agents sind die Zielgruppe des async-Flows.** Der ganze 0.9.0 async-default existiert um AI-Agents nicht in Wait-Loops blockieren zu lassen. Wenn die Default-Zielgruppe keinen guten Default kriegt, ist das Feature kaputt.
2. **Humans können den Block ignorieren.** Schlimmstenfalls lesen sie zwei Absätze zu viel.
3. **Agents ohne Instruktion können den Flow gar nicht nutzen.** Ohne "For agents:" Block ist der async-Output für einen Agent ununterscheidbar von einem regulären exit-0 "done".
4. **Humans konfigurieren einmal, Agents nie.** Ein Mensch der regelmäßig `apes` benutzt und den kurzen Block will setzt einmal `export APES_USER=human` in seiner `.zshrc`. Ein AI-Agent setzt selten Env-Vars vor `spawn()` Aufrufen.

Zero-config für die Primär-Zielgruppe, one-line rc für die Sekundär-Zielgruppe.

### 4. Script-Kompatibilität ist erhalten

Beide Modi drucken dieselben Core-Label-Zeilen:

- URL-Zeile enthält immer `grant-approval?grant_id=<uuid>`
- Status-Zeile enthält immer `apes grants status <uuid>`
- Execute-Zeile enthält immer `apes grants run <uuid>`

Existing Scripts die mit grep/sed/regex diese Strings extrahieren brechen nicht. Der Unterschied zwischen den beiden Modi ist nur der Prosa-Block drumrum.

## Philosophie — Text-First statt Skill-First

Eine alternative Lösung für das Gap wäre gewesen: eine Claude-Skill schreiben die dem LLM erklärt wie der async-Flow funktioniert. Das hätte Claude spezifisch geholfen, aber nicht openclaw, ChatGPT, Cursor, oder jeden zukünftigen Agent.

Text-First beat Skill-First aus drei Gründen:

1. **Portabilität.** Jeder Agent in jedem Ökosystem bekommt automatisch dieselben Instruktionen ohne per-tool Integration. Der `apes` CLI ist der Single Source of Truth, nicht per-vendor Skill-Files.

2. **Versionierung.** Wenn die Polling-Policy sich ändert (z.B. 15s statt 10s default), ändert sich der Text automatisch weil er die aktuellen Config-Werte zur Laufzeit embedded. Skills würden out-of-date gehen und müssten pro Ökosystem nachgezogen werden.

3. **Debuggability.** Ein Mensch der das Output liest sieht exakt was ein Agent lesen würde. Keine versteckten Skill-Files, keine "was denkt sich der Agent gerade" Mysterien.

Skills können trotzdem als dünne Wrapper oben drauf sitzen ("wenn du apes-run Output siehst, folg den Instructions literal"), aber der primäre Mechanismus ist der CLI-Output selbst.

## Test-Manifest

**11 neue Tests** in `packages/apes/test/commands-run-async.test.ts` im neuen `async info block audience mode` describe:

| # | Test | Was es verifiziert |
|---|---|---|
| 1 | Default (no env, no config) | agent mode feuert, polling block enthalten |
| 2 | `APES_USER=human` | human mode, short block, keine polling instructions |
| 3 | `APES_USER=agent` | explicit agent setzen = wie default |
| 4 | `APES_USER=invalid` | garbage fällt zurück auf agent default |
| 5 | `config.toml defaults.user=human` | config override funktioniert |
| 6 | `APES_USER` env wins over config | env priority korrekt |
| 7 | `APES_GRANT_POLL_INTERVAL=30` | "every 30s" im text |
| 8 | `APES_GRANT_POLL_MAX_MINUTES=10` | "up to 10 minutes" im text |
| 9 | config fallback ohne env | `grant_poll_interval_seconds` aus config |
| 10 | env wins over config für numeric knobs | env beats config für beide Werte |
| 11 | bogus env values ignored | `not-a-number` + `-5` → default applied |

**Mock-Anpassungen** im existing Setup:
- `vi.mock('../src/config.js', ...)` um `loadConfig: vi.fn(() => ({}))` erweitert
- `beforeEach` resetted loadConfig auf leere Config damit `mockReturnValue()` aus einem Test nicht in den nächsten leakt

**Full `@openape/apes` suite via turbo**: 41 files, **466/466 green** (455 Baseline aus 0.9.2 + 11 neu)

## Release-Pipeline

| Stage | SHA / Run | Result |
|---|---|---|
| Worktree von `origin/main` (`633d8ce`) | | ✓ |
| Code-Änderungen + 11 neue Tests | `559a9ad` | 21/21 scoped green |
| PR #98 pushed → validate | `24409742807` | ✓ |
| Admin squash-merge PR #98 | `676caba` | ✓ |
| ci auf `676caba` | `24409878506` | ✓ |
| release auf `676caba` → opens version-packages PR #99 | `24410008879` | ✓ |
| Admin squash-merge PR #99 (version packages) | `2667784` | ✓ |
| ci auf `2667784` | `24410098804` | ✓ |
| release auf `2667784` → **npm publish** | `24410212327` | ✓ |
| `npm view @openape/apes@0.9.3` | | **0.9.3** ✓ |
| main fast-forwarded, rebuilt | | ✓ |
| `/usr/local/bin/apes --version` | | **0.9.3** ✓ |

## Files-Manifest

### 0.9.3

**Source (geändert):**

- `packages/apes/src/commands/run.ts` — `printPendingGrantInfo` umgeschrieben mit zwei Modi (agent/human), neue Helper `getUserMode` / `getPollIntervalSeconds` / `getPollMaxMinutes`, `loadConfig` import
- `packages/apes/src/config.ts` — `ApesConfig.defaults` erweitert um `user`, `grant_poll_interval_seconds`, `grant_poll_max_minutes` (alle optional, alle strings wegen hand-rolled TOML parser)

**Tests (erweitert):**

- `packages/apes/test/commands-run-async.test.ts` — 11 neue Tests im neuen describe block + `loadConfig` mock + `beforeEach` reset

**Changeset:**

- `.changeset/feat-async-grant-agent-text.md` — patch bump, detaillierte Release-Notes

## Nachfolge-Arbeit (explizit out-of-scope für 0.9.3)

- **`apes workflow show async-grant`**: der Workflow-File für das async-Grant-Protokoll existiert noch nicht. Der agent-mode Text enthält bewusst *keine* Referenz darauf, weil der Agent sonst einen Non-Existent Command rufen würde und fail-handled werden müsste. Wenn `apes workflow` als Subcommand zukünftig shapes-registry-basiert wird oder lokale YAML/TOML workflow-Files supportet, kann ein `async-grant.toml` Workflow angelegt werden und der Output-Text kann `See \`apes workflow show async-grant\` for the full protocol.` ergänzen.

- **Skill für Claude Code spezifisch**: eine dünne `.claude/skills/apes-async-grant.md` die dem Claude-Agent sagt "lies den For agents: Block und folge den Instructions literal" wäre ein ein-zeiler-Skill der nichts duplizieren müsste. Optional, nicht blocking.

- **Extraktions-Regex für Script-Consumer**: wer die Grant-ID aus dem Output extrahieren will kann `apes grants status --json` parsen statt den Human-Text. Ein dokumentierter `--json` fallback für `apes run` (der nur die Grant-Info als JSON druckt) wäre eine saubere Machine-Interface, aber out-of-scope für 0.9.3.

- **Der `extractPositionals` Bug** aus run.ts:286-298 (pre-existing, kommt aus 0.9.0): behandelt jeden `--flag` als key-value und skipped den nächsten positional. Wartet weiterhin auf einen separaten Fix-PR.

## Lineage

`0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2 → 0.9.3`
