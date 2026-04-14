---
'@openape/apes': patch
---

fix(apes): `apes <subcmd>` im REPL muss nicht mehr durch den Grant-Flow

Der 0.9.0 async-default Grant-Flow hat einen Rekursions-Loop in der interaktiven `ape-shell` REPL aufgedeckt: `apes grants run <id>` selbst wurde durch `requestGrantForShellLine()` geschleust, der Shapes-Adapter für `apes` mapped den Call auf eine eigene Permission, und der REPL forderte einen *neuen* Grant an (für die Erlaubnis, einen anderen Grant auszuführen). Approve-URL → exit 0 → user muss noch einen Grant approven → gleiches Spiel rekursiv. Der async-Flow wurde dadurch in der REPL effektiv unbenutzbar.

## Der Fix

Ein früher `shell-internal` Dispatch-Pfad in `packages/apes/src/shell/grant-dispatch.ts`, der `apes <subcmd>` Invocations direkt approved, **bevor** der Adapter- oder Session-Grant-Pfad getriggert wird:

```ts
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

Der neue `mode: 'self'` auf `GrantLineResult` signalisiert Audit-Konsumern dass der Line als trusted REPL-intern executed wurde — kein Server-side Grant, keine Consume-Verification.

## Blocklist statt Whitelist

Die Entscheidung über welche `apes` Subcommands gegated bleiben folgt einer **Blocklist**-Philosophie statt einer Whitelist:

```ts
const APES_GATED_SUBCOMMANDS = new Set(['run', 'fetch', 'mcp'])
```

Nur drei Subcommands rechtfertigen shell-level Gating:

- **`run`** — spawnt arbiträre Executables; das ist der Kernzweck des Grant-Systems.
- **`fetch`** — forwarded den Bearer-Token an user-kontrollierte URLs; könnte Credentials exfiltrieren.
- **`mcp`** — bindet einen Network-Port und serves eine persistente API.

Alle anderen Subcommands (`whoami`, `health`, `grants list/run/status/approve/deny/revoke/token/delegate`, `config get/set`, `adapter install/list/show/uninstall`, `admin *`, `login`, `logout`, `enroll`, `init`, `register-user`, `explain`, `dns-check`, `workflows`) fallen automatisch in den `shell-internal` Pfad. Das sind alles entweder read-only Introspection, lokale Config-Mutationen im User-eigenen `$HOME`, oder IdP-Endpoints die bereits server-side durch den Auth-Token gescoped sind — Gating im Shell wäre redundant und macht nichts sicherer.

## Philosophie

> *Inside the ape-shell REPL, `apes` is the trust root — not a user-authored external action.*

Wenn der User bereits authentifiziert ist und im REPL operiert, ist `apes whoami` kein zu-approvender Grant, sondern ein Shell-internaler Dispatch-Call, analog zu bash's `cd`, `export`, oder `alias`. Der Shell-Grant-Layer soll nur Dinge gaten die anderswo *nicht* gated werden können — Code-Execution (`run`), Credential-Forwarding (`fetch`), persistente Services (`mcp`). Alles andere delegiert sich selbst an die darunterliegenden Auth-Layer (auth.json token, management token server-side, filesystem permissions).

## Bonus: `apes adapter install` ist jetzt konsistent mit dem Auto-Install-Pfad

Vorher war `apes adapter install curl` aus der REPL heraus grant-gated, während `loadOrInstallAdapter('curl')` beim Auto-Triggered-Install (durch `apes run --shell -- bash -c 'curl ...'`) un-gated durchrauschte. Beides ist dieselbe Operation — ein Registry-Fetch + lokaler File-Write im User-Config-Dir. Jetzt sind beide Pfade konsistent exempt.

## Security-Implikationen

Aufgegeben: shell-level Gating für `apes admin`, `apes register-user`, `apes enroll`. Diese Commands waren vorher via Grant-Flow gated, sind jetzt shell-internal.

**Das ist sicher**, weil jeder dieser Commands server-side auth-gated ist:
- `apes admin *` verlangt einen `management_token` in `config.toml`. Ohne Token → 401/403 vom IdP. Mit Token → User hat bereits out-of-band den Admin-Status zugewiesen bekommen; das shell-grant fügt keine zusätzliche Information hinzu.
- `apes register-user` verlangt denselben `management_token`. Gleiche Logik.
- `apes enroll` kreiert einen lokalen Ed25519-Keypair und hittet den public Enrollment-Endpoint. Der Enrollment-Endpoint verlangt Approval durch einen Admin — also auch server-side gated.

Behalten: gating für die drei Subcommands die *nicht* anderswo gegated sind.

## Tripwire

Ein neuer Test `blocklist tripwire: APES_GATED_SUBCOMMANDS stays in sync with known apes subcommands` iteriert durch die bekannten 17 Top-Level-Subcommands aus `cli.ts` und verifiziert dass exakt `run`, `fetch`, `mcp` gegated werden und alle anderen self-dispatched. Wenn in einer zukünftigen Version ein neuer Subcommand addet wird, bricht dieser Test und zwingt im Code-Review die Klassifizierungs-Entscheidung: "ist das neue Ding `run`-like (spawner), `fetch`-like (credential forwarder), `mcp`-like (persistent server), oder fällt es ins default-trusted Lager?".

## Test-Bilanz

12 neue Tests in `packages/apes/test/shell-grant-dispatch.test.ts`:

- 7 self-dispatch tests: `apes whoami`, `apes grants run <id>`, `apes grants list`, `apes adapter install curl`, `apes admin users list`, `apes config set foo bar`, `apes health`
- 3 still-gated tests: `apes run -- echo hello`, `apes fetch https://example.com`, `apes mcp server`
- 1 compound regression guard: `apes whoami | grep alice` → gated via session path (compound short-circuits the self-dispatch)
- 1 blocklist tripwire: iterates known subcommands, asserts exact gating set
