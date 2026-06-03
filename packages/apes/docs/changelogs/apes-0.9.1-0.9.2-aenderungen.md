# Die Änderungen in `@openape/apes@0.9.1` und `0.9.2`

Beides sind kleine Patch-Releases die in einer Live-Debugging-Session am 2026-04-14 nach dem 0.9.0 Release entstanden sind. 0.9.1 fixed cosmetische Display-Bugs die beim ersten End-to-End-Test gegen `id.openape.at` sichtbar wurden, 0.9.2 fixed den echten Usability-Blocker der den neuen async-Flow in der interaktiven REPL unbenutzbar gemacht hätte.

---

## 0.9.1 — `apes grants status` Display-Fix

### Das Problem

Beim Live-Test von `apes grants run <id>` gegen den `claude-test` Agent sah die `apes grants status <id>` Ausgabe so aus:

```
$ apes grants status e887a7e3-6f8c-4503-bb50-18f47585deb8
Grant:     e887a7e3-6f8c-4503-bb50-18f47585deb8
Status:    approved
Type:      null               ← immer null auf dem aktuellen IdP
Requester: undefined          ← Feld existiert nur unter request.requester
Owner:     undefined          ← Feld existiert überhaupt nicht im API-Response
Command:   whoami
Approval:  once
Reason:    ape-shell: Show current username
Decided by: patrick@hofmann.eco
Decided at: 1776154298        ← Unix-Timestamp als Rohzahl
```

Vier Bugs auf einmal:

1. **`Type: null`** — ein top-level `type` Feld existiert auf dem aktuellen Free-IdP `GET /grants/<id>` Response immer als `null`. Vermutlich ein Holdover aus einem früheren API-Shape.

2. **`Requester: undefined`** — das Status-Command las `grant.requester`, aber der API-Response hat dieses Feld unter `grant.request.requester` (nested).

3. **`Owner: undefined`** — ein `owner` Feld existiert **überhaupt nicht** auf dem API-Response. War ein Relikt aus einem früheren Schema.

4. **`Decided at: 1776154298`** — Timestamps kommen vom API als Unix-Sekunden (number), wurden aber als Strings unchanged auf den Terminal gedruckt.

### Der Fix

Das `GrantDetail` TypeScript-Interface in `packages/apes/src/commands/grants/status.ts` wurde vollständig an die tatsächliche API-Shape angepasst:

```ts
interface GrantDetail {
  id: string
  type?: string | null
  status: string
  request?: {
    requester?: string
    target_host?: string
    audience?: string
    grant_type?: string
    command?: string[]
    reason?: string
  }
  created_at?: number
  decided_at?: number
  decided_by?: string
  used_at?: number
  expires_at?: number
}
```

Neuer Helper für ISO-Formatierung mit graceful fallback:

```ts
function formatTs(ts: number | undefined): string | undefined {
  if (ts === undefined || ts === null) return undefined
  const ms = ts * 1000
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms).toISOString()
}
```

Der Output-Block wurde refactored:
- **Entfernt**: `Type:`, `Owner:`, `Approver:` Zeilen — existieren nicht im API.
- **Gefixt**: `Requester:` liest jetzt aus `grant.request.requester` mit graceful skip bei undefined.
- **Gefixt**: `Decided at:` und `Expires:` werden via `formatTs` als ISO-8601 gedruckt.
- **Hinzugefügt**: `Audience:` Zeile — wichtig weil `apes grants run <id>` seit 0.9.0 nach Audience dispatcht (shapes / escapes / ape-shell).
- **Hinzugefügt**: `Host:` Zeile (`request.target_host`) — wichtig für host-gebundene Session-Grants.
- **Hinzugefügt**: `Created:` und `Used at:` Zeilen — waren vorher nicht sichtbar.

`--json` Modus bleibt unverändert: dumpt die rohe API-Response direkt.

### Nach dem Fix sieht der Output so aus

```
$ apes grants status e887a7e3-6f8c-4503-bb50-18f47585deb8
Grant:     e887a7e3-6f8c-4503-bb50-18f47585deb8
Status:    used
Audience:  shapes
Requester: claude-test+patrick+hofmann_eco@id.openape.at
Host:      Mac-mini-von-Patrick.fritz.box
Command:   whoami
Approval:  once
Reason:    ape-shell: Show current username
Created:   2026-04-14T08:10:58.000Z
Decided by: patrick@hofmann.eco
Decided at: 2026-04-14T08:11:38.000Z
Used at:   2026-04-14T08:11:51.000Z
```

### Test-Manifest

- **Neu**: `packages/apes/test/commands-grants-status.test.ts` (197 Zeilen, 6 Tests)
  1. Prints all expected fields for an approved shapes grant
  2. Formats all timestamps as ISO-8601, not raw unix numbers
  3. Does not print deprecated Type / Owner / Approver lines (+ no stringified undefined/null)
  4. Omits optional fields that are missing from the API response
  5. JSON mode emits the raw API payload untouched
  6. Handles an ape-shell session grant shape

- **Full `@openape/apes` suite via turbo**: 41 files, **443/443 green** (437 aus 0.9.0 + 6 neu)

### Release-Pipeline

| Stage | SHA / Run |
|---|---|
| PR #94 pushed → validate | `24388573520` ✓ |
| Admin squash-merge PR #94 | `b0c55bd` |
| ci + release auf `b0c55bd` → opens version-packages PR #95 | ✓ |
| Admin squash-merge PR #95 (version packages) | `b17ec24` |
| ci + release auf `b17ec24` → npm publish | `24388829481` ✓ |
| `npm view @openape/apes version` | **0.9.1** ✓ |

---

## 0.9.2 — Self-Dispatch Shortcut für `apes` Subcommands in der REPL

### Das Problem (der 0.9.0 async-Flow hat sich ins eigene Knie geschossen)

Unmittelbar nach 0.9.0 wurde beim Live-Test klar dass der neue async-Default einen Rekursions-Loop produziert sobald man ihn aus der interaktiven `ape-shell` REPL heraus benutzen will. Beispiel:

```
apes$ apes run -- whoami
ℹ Installing shapes adapter for apes from registry...
ℹ Requesting grant for: Execute with elevated privileges: whoami
✔ Grant e887a7e3-... erstellt
  Approve:   ...
  Ausführen: apes grants run e887a7e3-...

apes$ apes grants run e887a7e3-...          ← User tippt den "Ausführen" Command
ℹ Installing shapes adapter for apes from registry...
ℹ Requesting grant for: Execute apes grants run e887a7e3-...   ← wtf
✔ Grant <NEUER-id> erstellt
  Ausführen: apes grants run <NEUER-id>    ← 🤦 — einen Grant genehmigen um einen Grant auszuführen
```

Die Ursache ist strukturell: der REPL in `packages/apes/src/shell/grant-dispatch.ts` schleust jeden Shell-Line durch `requestGrantForShellLine()`, und für den ersten Token `apes` existiert im Shapes-Registry ein eigener Adapter der jede `apes <subcmd>` Invocation auf eine spezifische Permission mapped. Jeder Subcommand kriegt seinen eigenen Grant. Der async-Default macht das sichtbar — vorher wurde es vom Blocking-Loop kaschiert weil man nie den zweiten Aufruf getippt hat, jetzt ist der zweite Aufruf der ganze Punkt des neuen Flows.

### Der Fix — Blocklist statt Whitelist

Neuer Early-Return in `requestGrantForShellLine`, noch bevor der Adapter-Pfad oder Session-Grant-Pfad getriggert werden. Nur drei `apes` Subcommands bleiben gegated:

```ts
const APES_GATED_SUBCOMMANDS = new Set(['run', 'fetch', 'mcp'])

if (parsed && !parsed.isCompound) {
  const invokedName = basename(parsed.executable)
  if (invokedName === 'apes' || invokedName === 'apes.js') {
    const subCommand = parsed.argv[0]
    if (subCommand && !APES_GATED_SUBCOMMANDS.has(subCommand)) {
      return { kind: 'approved', grantId: 'shell-internal', mode: 'self' }
    }
  }
}
```

Neuer `mode: 'self'` auf `GrantLineResult` + `ShellSession.logLineGranted` widening. Der Audit-Log markiert den Line als trusted shell-internal Dispatch — kein Server-side Grant, keine Consume-Verification.

### Warum nur `run`, `fetch`, `mcp` gegated bleiben

| Subcommand | Warum gegated |
|---|---|
| `run` | Spawnt arbiträre Executables — der Kernzweck des Grant-Systems |
| `fetch` | Forwarded den Auth-Bearer-Token an eine user-spezifizierte URL — Credential-Exfiltration-Risiko |
| `mcp` | Bindet einen Network-Port und serves eine persistente API |

Alle anderen Subcommands — `whoami`, `health`, `explain`, `dns-check`, `workflows`, `login`, `logout`, `enroll`, `config`, `adapter`, `init`, `register-user`, `grants`, `admin` — sind entweder read-only Introspection, lokale Config-Mutationen im User-eigenen `$HOME`, oder IdP-Endpoints die bereits server-side durch den Auth-Token oder Management-Token gescoped sind. Shell-level Gating würde weder zusätzliche Sicherheit bringen noch in den einen Fall wo es greift (nämlich Inside-REPL recursive `apes grants run`) Sinn ergeben.

### Die Philosophie

> *Inside the ape-shell REPL, `apes` is the trust root — not a user-authored external action.*

Wenn der User bereits als apes-Agent authentifiziert ist und im REPL operiert, ist `apes whoami` kein zu-approvender Grant sondern ein Shell-internaler Dispatch-Call, analog zu bash's `cd`, `export`, `alias`. Der Shell-Grant-Layer gatet **nur** Dinge die anderswo nicht gated werden können: Code-Execution (`run`), Credential-Forwarding (`fetch`), persistente Services (`mcp`). Alles andere delegiert sich selbst an die darunterliegenden Auth-Layer.

### Security-Trade-off

Aufgegeben: shell-level Gating für `apes admin`, `apes register-user`, `apes enroll`.

Behalten durch darunterliegende Auth-Layer:
- `apes admin *` verlangt einen `management_token` in `config.toml`. Ohne Token → 401/403 vom IdP. Mit Token hat der User bereits out-of-band den Admin-Status zugewiesen bekommen, und das shell-grant fügt keine zusätzliche Kontrolle hinzu — es ist pure Friction.
- `apes register-user` — gleiche management-token-Logik server-side.
- `apes adapter install` — paralled mit dem bereits un-gateten Auto-Install-Pfad in `loadOrInstallAdapter`.

### Das `adapter install` Bonus-Fix

Vorher war `apes adapter install curl` aus der REPL grant-gated, während `loadOrInstallAdapter('curl')` beim Auto-Triggered-Install (durch `apes run --shell -- bash -c 'curl ...'`) un-gated durchrauschte. Dieselbe Operation — ein Registry-Fetch und ein lokaler File-Write in `~/.config/apes/shapes/adapters/` — aber inkonsistent gegated. Jetzt sind beide Pfade konsistent exempt.

### Tripwire-Test gegen künftige Subcommand-Additions

Der neue Test `blocklist tripwire: APES_GATED_SUBCOMMANDS stays in sync with known apes subcommands` iteriert durch alle 17 Top-Level-Subcommands aus `cli.ts` und verifiziert behavioral (nicht per Import), dass exakt `run` / `fetch` / `mcp` gegated werden:

```ts
const KNOWN_APES_SUBCOMMANDS = [
  'init', 'enroll', 'register-user', 'dns-check',
  'login', 'logout', 'whoami', 'health',
  'grants', 'admin', 'run', 'explain', 'adapter',
  'config', 'fetch', 'mcp', 'workflows',
]
const EXPECTED_GATED = ['fetch', 'mcp', 'run'].sort()
// ... iteriert und assertet das beobachtete Gating-Set
```

Wenn in einer zukünftigen Version jemand ein neues `apes backup-everything-to-s3` hinzufügt, bricht dieser Test im CI und zwingt im Code-Review die Klassifizierungs-Entscheidung: "ist das neue Ding `run`-like / `fetch`-like / `mcp`-like, oder gehört es ins default-trusted Lager?"

### Test-Manifest

- **Bestehend**: `packages/apes/test/shell-grant-dispatch.test.ts` um 12 neue Tests erweitert (15 Baseline → 27):
  - 7 self-dispatch tests: `apes whoami`, `apes grants run <id>`, `apes grants list`, `apes adapter install curl`, `apes admin users list`, `apes config set foo bar`, `apes health`
  - 3 still-gated tests: `apes run -- echo hello`, `apes fetch https://example.com`, `apes mcp server`
  - 1 compound regression guard: `apes whoami | grep alice` → fällt durch zur session path (compound short-circuits die shortcut)
  - 1 blocklist tripwire snapshot

- **Full `@openape/apes` suite via turbo**: 41 files, **455/455 green** (443 aus 0.9.1 + 12 neu)

### Release-Pipeline

| Stage | SHA / Run |
|---|---|
| PR #96 pushed → validate | `24407496270` ✓ 1m39s |
| Admin squash-merge PR #96 | `8a85a02` |
| ci + release auf `8a85a02` → opens version-packages PR #97 | ✓ |
| Admin squash-merge PR #97 (version packages) | `633d8ce` |
| ci + release auf `633d8ce` → npm publish | `24408071314` ✓ |
| `npm view @openape/apes version` | **0.9.2** ✓ |

---

## Zusammen betrachtet

0.9.1 und 0.9.2 sind beide Follow-ups die erst durch das Live-Testen des 0.9.0 Release entstanden sind — das eine ein cosmetischer Bug in einem Command der vorher nie kritischer Debug-Pfad war, das andere ein struktureller Flow-Bug den der neue async-Default erst sichtbar gemacht hat. Beide klein, beide fokussiert, beide vollständig getestet, beide live released.

**Lineage:** `0.7.2 → 0.8.0 → 0.9.0 → 0.9.1 → 0.9.2`

**Total offene Fragen:** bisher `extractPositionals` Bug in `run.ts:286-298` (behandelt jeden `--flag` als key-value und skipped den nächsten token, deswegen routet `apes run --wait escapes mount-nfs` nicht korrekt). Out-of-scope für alle 5 obigen Releases, wartet auf einen separaten kleinen Follow-up-PR. Workaround: `--wait` nach den positionals stellen oder `APE_WAIT=1` verwenden.

## Files-Manifest

### 0.9.1

**Source:**
- `packages/apes/src/commands/grants/status.ts` — Rewrite des Interfaces + formatTs helper + Output-Block

**Tests (neu):**
- `packages/apes/test/commands-grants-status.test.ts` (197 Zeilen, 6 Tests)

**Changeset:**
- `.changeset/fix-grants-status-display.md` (patch bump)

### 0.9.2

**Source:**
- `packages/apes/src/shell/grant-dispatch.ts` — APES_GATED_SUBCOMMANDS blocklist + self-dispatch shortcut + new `mode: 'self'` on GrantLineResult
- `packages/apes/src/shell/session.ts` — `logLineGranted` widening to accept `'self'` mode

**Tests (erweitert):**
- `packages/apes/test/shell-grant-dispatch.test.ts` +245 Zeilen (12 neue Tests incl. tripwire)

**Changeset:**
- `.changeset/fix-repl-exempt-apes-self.md` (patch bump)
