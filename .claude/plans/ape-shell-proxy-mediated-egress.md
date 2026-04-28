# Plan: `apes proxy --` foundation + ape-shell egress mediation

> Dieser Plan ist **self-contained**: ein Agent oder Mensch ohne Vorwissen muss ihn von
> oben nach unten lesen und ein funktionierendes Ergebnis produzieren können. Alle
> Pfade sind repo-relativ zu `openape-monorepo/`.

## Purpose / Big Picture

**Ziel:** Zwei aufeinander aufbauende user-sichtbare Capabilities.

1. **`apes proxy -- <cmd>`** als general-purpose Subcommand: jeder Skript/Agent/User
   kann beliebige Commands "durch den OpenApe-Proxy" laufen lassen. Per-Invocation
   Lifecycle: Proxy startet, `HTTPS_PROXY` wird gesetzt, command läuft,
   Proxy wird beim Exit gestoppt. Allow/Deny/Grant-Required-Regeln entscheiden ob
   Egress-Calls rausgehen, Audit-Trail JSONL.
2. **`ape-shell` opt-in via `OPENAPE_PROXY_URL`**: ape-shell startet **keinen**
   Proxy automatisch. Wenn der User vor dem ape-shell-Start `OPENAPE_PROXY_URL`
   in seinem Shell-Env gesetzt hat (z.B. `openape-proxy &` plus `export
   OPENAPE_PROXY_URL=http://127.0.0.1:9090`), injiziert ape-shell `HTTPS_PROXY`
   passend ins Bash-env. Ohne gesetzte env-var verhält sich ape-shell exakt wie heute
   — keine Verhaltensänderung, keine implizite Mediation. `apes proxy --` honoriert
   `OPENAPE_PROXY_URL` analog: gesetzt → kein eigenes Spawn, einfach existing reusen.

Kein MITM, kein Token-Swap, kein neues Trust-Boundary-Theater. Nur **Host-basiertes
Policy-Gating + Audit** auf der Egress-Schicht — als zusätzliche Verteidigungslinie
zum existierenden Per-Line-Grant-Flow auf der Bash-Schicht.

**Kontext:** OneCLI-Diskussion 2026-04-26. Patrick wollte Trust-Boundary für
Agent-Outbound härten ohne MITM/CA-Inject. `@openape/proxy` (v0.2.14, `packages/proxy/`)
ist bereits ein Forward-Proxy mit Grant-Integration zum eigenen IdP. Architektur-
Vorschlag von Patrick (2026-04-27): `apes proxy --` analog zu `apes run --root → escapes`,
also ein eigenständiges Tool das per-Invocation aufgerufen werden kann — nicht ein
für-immer-an-`ape-shell`-gekettetes Embedding. Stack bleibt TS/Node/Bun.

**Scope (drin):**
- `@openape/apes` bekommt neues Subcommand `apes proxy -- <cmd>`.
- `@openape/proxy` bekommt Node-runnable `dist/cli.js` (tsup build), wird runtime-dep
  von `@openape/apes`.
- Default + Per-User TOML-Config (`~/.config/openape/proxy.toml`).
- Auth zwischen apes und Proxy: ephemeral agent-JWT via `@openape/cli-auth`
  (RFC8693 Token-Exchange).
- ape-shell-Integration via `OPENAPE_PROXY_URL`-Env-Discovery (daemon reuse).
- Per-Line Env-Overlay für Grant-IDs (Patrick's "manchen Commands env erzwingen").
- Audit-Surfacing in ape-shell-REPL.

**Scope (nicht drin):**
- MITM/TLS-Termination, URL-Path-/Header-/Body-Inspection.
- Token-Swap (Placeholder → echter Upstream-Key) à la OneCLI.
- OS-Level Egress-Firewall (Agent kann Proxy umgehen wenn er env-vars löscht).
- Capability-Sandboxing per `sandbox-exec` / `bwrap`.

## Repo-Orientierung

- **Projekt:** openape-monorepo, branch off latest `origin/main`.
- **Relevante Pakete + Pfade:**
  - `packages/apes/` — `@openape/apes` v0.12.6+.
    - `src/cli.ts` — citty entry inkl. `ape-shell`-rewrite-pfad.
    - `src/commands/` — Subcommand-Files. `apes proxy --` neu in `src/commands/proxy.ts`.
    - `src/commands/run.ts` — Vorbild-Pattern (`execFileSync escapes --grant ... -- ...`).
    - `src/shell/orchestrator.ts` — REPL-Entry, hier wird Daemon hochgezogen.
    - `src/shell/pty-bridge.ts` — wrapt persistent bash, Marker-PS1.
    - `src/shell/repl-dispatch.ts` / `oneshot-dispatch.ts` — Per-Line-Pipeline.
  - `packages/proxy/` — `@openape/proxy` v0.2.14.
    - `src/index.ts` — bun-shebang Entry, `parseArgs` + `createServer`. Muss zu
      Node-runnable `dist/cli.js` gebaut werden (tsup).
    - `src/proxy.ts` — `createNodeHandler(config)`, exportiert.
    - `src/connect.ts` — CONNECT-Tunneling für HTTPS.
    - `src/auth.ts` — `verifyAgentAuth(authHeader, idpUrl, mandatory)`.
    - `src/config.ts` — `loadMultiAgentConfig(path)`.
    - `src/audit.ts` — `initAudit(path)`, JSONL-Append.
    - `config.example.toml` — Schema-Beispiel.
  - `packages/cli-auth/` — `@openape/cli-auth`, Token-Cache + RFC8693-Exchange.
  - `packages/grants/`, `packages/core/` — bereits Deps des Proxy.
- **Tech-Stack:** Node 22+ (apes), TypeScript, PNPM workspaces, turbo, tsup, vitest, citty.
  Stack-Entscheidung 2026-04-27: bewusst TS/Node/Bun — kein Sprachwechsel für Proxy.
- **Dev-Setup:**
  - `pnpm install` im Repo-Root.
  - `pnpm --filter @openape/apes build` — apes bundle.
  - `pnpm --filter @openape/apes dev` für Watch.
  - `pnpm --filter @openape/proxy build` — proxy bundle (Node-target).
  - Proxy lokal probieren: `bun packages/proxy/src/index.ts -c packages/proxy/config.example.toml`.
  - Tests: `pnpm --filter @openape/apes test` (vitest, 533+ Tests).
  - Lint/typecheck: `pnpm check` (root, oxlint + tsc).

## Open Questions / Discovery vor M0

1. **`@openape/proxy` Build-Target.** Aktueller bin: `src/index.ts` mit
   `#!/usr/bin/env bun`. Für npm-Install global brauchen wir einen Node-runnable
   Bundle in `dist/cli.js`. tsup-config prüfen, ggf. `--platform=node --target=node22`
   ergänzen + bin-shebang umstellen.
2. **Cross-package bin-resolution.** `apes proxy --` muss `openape-proxy`-binary
   finden ohne PATH-Annahmen. Lösung: `require.resolve('@openape/proxy/package.json')`
   → `bin`-Eintrag aus dem JSON lesen → absoluter Pfad → `execFileSync(absPath, ...)`.
3. **Daemon-Discovery via env.** `OPENAPE_PROXY_URL` ist die Konvention. Wenn gesetzt
   und via TCP erreichbar → reuse, sonst spawn. Plus `OPENAPE_PROXY_PID` damit der
   Cleanup-Mechanismus weiß was er killen muss.
4. **Auth-Modus.** Erste Iteration: `mandatoryAuth: false`, JWT optional. Härten
   in M3.
5. **Feature-Flag.** `OPENAPE_SHELL_PROXY=0` deaktiviert die ape-shell-Integration
   für Power-User-Debug. `apes proxy --` als Subcommand funktioniert immer.

## Milestones

Jeder Milestone ist unabhängig testbar. Pro Session max. einer.

### Milestone 0: `@openape/proxy` Node-runnable + Wiring

**Ziel:** Nach `pnpm install` + `pnpm build` existiert ein `node`-startbares
`packages/proxy/dist/cli.js`. `@openape/proxy` ist als runtime-dep in `packages/apes/package.json`.

**Schritte:**
1. `packages/proxy/tsup.config.ts` (oder package.json `tsup` block) so konfigurieren dass
   ein `dist/cli.js` rauskommt mit:
   - shebang `#!/usr/bin/env node`
   - target node22
   - format esm (oder cjs, je nach was im monorepo Standard ist)
   - external: keine — alle deps inline (smol-toml, jose, @openape/core, @openape/grants)
2. `packages/proxy/package.json` `bin` umstellen: `"openape-proxy": "./dist/cli.js"`.
3. `packages/proxy/package.json` `files` enthält `dist`.
4. `packages/apes/package.json` `dependencies` ergänzen: `"@openape/proxy": "workspace:*"`.
5. `pnpm install && pnpm --filter @openape/proxy build && pnpm --filter @openape/apes build`
   muss clean durchlaufen.

**Akzeptanzkriterien:**
- [ ] `node packages/proxy/dist/cli.js -c packages/proxy/config.example.toml` startet
      und logged `[openape-proxy] Listening on http://127.0.0.1:9090`.
- [ ] `node -e "console.log(require.resolve('@openape/proxy/package.json'))"`
      ausgeführt im `packages/apes`-Cwd liefert einen Pfad.
- [ ] `pnpm --filter @openape/apes typecheck` clean.

**Rollback:** Trivial — Edits revertieren, dependency-eintrag entfernen.

### Milestone 1a: `apes proxy -- <cmd>` Subcommand (foundation)

**Ziel:** General-purpose Subcommand. Spiegelt das Pattern von `apes run --root → escapes`.
Per-Invocation Lifecycle: Proxy spawnt, command läuft, Proxy stirbt.

**Schritte:**
1. Neue Datei `packages/apes/src/commands/proxy.ts` als citty-Subcommand:
   ```ts
   export const proxyCommand = defineCommand({
     meta: { name: 'proxy', description: 'Run a command through the OpenApe egress proxy.' },
     args: {
       /* nicht-`--` args sind via `args._` der wrapped command;
          additional flags: --grant <name>, --config <path>, --no-auth */
     },
     async run(ctx) {
       // 1. Resolve config (default + ~/.config/openape/proxy.toml overlay)
       // 2. Spawn openape-proxy as child, wait for it to listen
       // 3. Mint agent-JWT via @openape/cli-auth (token-exchange)
       // 4. Build env: HTTPS_PROXY=http://127.0.0.1:<port>, HTTP_PROXY=...
       //    Optional: NO_PROXY=127.0.0.1,localhost
       // 5. execFileSync(wrapped[0], wrapped.slice(1), { stdio:'inherit', env })
       // 6. on exit: SIGTERM proxy child, wait, force-kill if needed
     },
   })
   ```
2. Implementiere `startEphemeralProxy(config)`:
   - `child_process.spawn('node', [resolvedProxyBin, '-c', tempConfigPath])`
   - liest stdout zeile für zeile bis `[openape-proxy] Listening on http://127.0.0.1:<port>`
   - extrahiert Port → return `{ proc, port, url, close: ... }`
3. Implementiere `findProxyBin(): string`:
   - `dirname(require.resolve('@openape/proxy/package.json'))` + bin-Eintrag
4. Default-Config-Builder `buildDefaultProxyConfig({ port: 0 })`:
   - `default_action: "allow"` für M1a, hardening in M3
   - Deny-Liste: `169.254.169.254`, `metadata.google.internal`, `*.internal`
   - Allow-Liste: `registry.npmjs.org`, `*.openape.ai`, `*.openape.at`,
     `api.github.com`, `objects.githubusercontent.com`
   - Audit-Log: `${XDG_STATE_HOME:-$HOME/.local/state}/openape/proxy-audit.jsonl`
5. CLI-Wiring in `src/cli.ts`: `apes proxy --` als citty subcommand registrieren.

**Akzeptanzkriterien:**
- [ ] `apes proxy -- echo PROXY=$HTTPS_PROXY` → Output enthält
      `PROXY=http://127.0.0.1:` gefolgt von einer Port-Zahl > 0.
- [ ] `apes proxy -- curl -sS -o /dev/null -w '%{http_code}' https://api.github.com/zen`
      liefert `200`. Im Audit-File neue Zeile `{"event":"connect","host":"api.github.com",...}`.
- [ ] Nach `apes proxy -- sleep 1`-Exit: `lsof -nP -iTCP -sTCP:LISTEN | grep openape-proxy`
      liefert nichts (Proxy gestorben).
- [ ] `apes proxy -- bash -c 'curl http://169.254.169.254/'` → curl exit nicht-null
      (vom Proxy geblockt).

**Rollback:** Subcommand registrieren rückgängig, Datei `proxy.ts` löschen.

### Milestone 1b: ape-shell respektiert `OPENAPE_PROXY_URL` (opt-in, kein Autostart)

**Ziel:** Wenn der User vor `ape-shell`-Start `OPENAPE_PROXY_URL` gesetzt hat,
injiziert ape-shell `HTTPS_PROXY` aus dieser URL ins Bash-env. Ohne gesetzte
env-var: kein Verhaltens-Diff zum Status-quo. Kein Autostart, kein Daemon-
Lifecycle in ape-shell.

**Why no autostart:** Patrick (2026-04-27): User soll explizit selbst entscheiden ob
ein Proxy läuft (`openape-proxy &` plus `export OPENAPE_PROXY_URL=...`). ape-shell
ist nur Konsument, kein Lifecycle-Owner.

**Schritte:**
1. PtyBridge `extraEnv: Record<string, string>`-Parameter ergänzen (auch M4 braucht das).
2. In `src/shell/orchestrator.ts` (`runInteractiveShell`):
   - Lese `process.env.OPENAPE_PROXY_URL`.
   - Wenn gesetzt: PtyBridge-extraEnv enthält
     ```ts
     {
       HTTPS_PROXY: process.env.OPENAPE_PROXY_URL,
       HTTP_PROXY: process.env.OPENAPE_PROXY_URL,
       NO_PROXY: process.env.NO_PROXY ?? '127.0.0.1,localhost',
     }
     ```
     Dazu einmalig auf stderr: `[ape-shell] using egress proxy at <url>`.
   - Wenn nicht gesetzt: extraEnv leer, keine Logzeile, alles unverändert.
3. `apes proxy --` (M1a) detection-pfad ergänzen:
   - Wenn `process.env.OPENAPE_PROXY_URL` gesetzt:
     - **Skip spawn**, nur `HTTPS_PROXY=$OPENAPE_PROXY_URL` ins env des wrapped cmd.
   - Sonst: full ephemeral spawn (M1a default).
4. **Kein** Daemon-Spawn in ape-shell, **kein** `OPENAPE_SHELL_PROXY`-Feature-Flag
   nötig (env nicht gesetzt = kein Proxy = entspricht Flag-aus).

**Akzeptanzkriterien:**
- [ ] **Ohne** `OPENAPE_PROXY_URL`: `apes ape-shell -c "echo HTTPS_PROXY=$HTTPS_PROXY"`
      → leere Variable. Kein Process von `openape-proxy` gestartet.
- [ ] **Mit** `OPENAPE_PROXY_URL=http://127.0.0.1:9090`:
      `OPENAPE_PROXY_URL=http://127.0.0.1:9090 apes ape-shell -c "echo HTTPS_PROXY=$HTTPS_PROXY"`
      → druckt die URL.
- [ ] Mit gesetzter URL und einem davor manuell gestarteten `openape-proxy &`:
      `apes ape-shell -c "curl https://api.github.com/zen"` → 200, Audit-File des
      manuell gestarteten Proxy enthält den Eintrag.
- [ ] `apes proxy -- curl ...` ohne env-var: spawnt eigenen ephemeren Proxy,
      stirbt mit Command. **Mit** env-var: re-uset existing, kein Spawn (PID-Count
      von openape-proxy unverändert).
- [ ] Nach ape-shell-Exit ohne env-var-Pfad: keine zurückgelassenen Proxy-Prozesse
      (war ja nie einer).

**Rollback:** orchestrator-Patch revertieren — Bash-env unverändert.

### Milestone 2: Default-Config + Per-User-Overlay

**Ziel:** Sinnvolle, konservative Default-Regeln. User kann via TOML überschreiben.

**Schritte:**
1. `packages/apes/src/proxy/config.ts`:
   - `DEFAULT_PROXY_CONFIG` als typed Konstante.
   - `loadProxyConfig()`: liest `${XDG_CONFIG_HOME:-$HOME/.config}/openape/proxy.toml`
     falls vorhanden, sonst Default. Logged `[apes-proxy] using <default|user> config`.
2. `apes proxy --` und ape-shell-Daemon nutzen beide `loadProxyConfig()`.
3. `docs/cli/apes-proxy.md` (NEW): User-Doku — Defaults, wie überschreiben, wie
   Feature-Flag.

**Akzeptanzkriterien:**
- [ ] User-Override-File mit `default_action = "deny"` setzen → erneutes
      `apes proxy -- curl https://example.com` schlägt fehl (vom Proxy geblockt).
- [ ] User-File löschen → curl auf api.github.com geht wieder durch (Allowlist).

**Rollback:** User-File löschen oder `OPENAPE_SHELL_PROXY=0`.

### Milestone 3: Auth — Ephemeral Agent-JWT für Proxy

**Ziel:** Jeder Outbound-Call hat ein verifiziertes Agent-Identity-JWT (`act:'agent'`,
`sub:<email>`). Proxy schreibt `agent_email` ins Audit, kann später per-agent-Regeln.

**Schritte:**
1. Bei `apes proxy --` und ape-shell-Daemon-Start: `await mintAgentToken({ aud:'openape-proxy' })`
   via `@openape/cli-auth` (RFC8693 Exchange, kurze TTL).
2. Token in `HTTPS_PROXY`-URL als userinfo: `http://x:<token>@127.0.0.1:<port>`.
   Proxy decodiert `password` als Bearer (fallback auf `Proxy-Authorization`-Header).
3. Default-Config auf `mandatory_auth = true`.
4. Token-Refresh: TTL großzügig (60min) für M3, daemon-side Refresh als TODO M5+.

**Akzeptanzkriterien:**
- [ ] Audit-Log enthält `agent_email` für jeden Eintrag.
- [ ] Manueller `curl -x http://127.0.0.1:<port> https://api.github.com/zen` ohne
      embedded creds → `407 Proxy Authentication Required`.

**Rollback:** Defaults zurück auf `mandatory_auth = false`.

### Milestone 4: Per-Line Env-Overlay & Grant-Header

**Ziel:** Pro Bash-Zeile in ape-shell: zusätzliche env-vars setzen. Wenn ein Grant
für die Zeile approved wurde, geht dessen ID als `X-Openape-Grant-Id` durch den
Proxy ins Audit.

**Schritte:**
1. In `src/shell/repl-dispatch.ts`: `wrapLineWithEnv(line, overlay)` Helfer der
   in `env A=1 B=2 -- bash -c '<line>'` rewriten kann (oder subshell-Prefix).
2. Approved Grant pro Zeile → `OPENAPE_GRANT_ID=<id>` im overlay,
   `OPENAPE_PROXY_EXTRA_HEADERS='X-Openape-Grant-Id: <id>'`.
3. `packages/proxy/src/audit.ts` erweitern um optional `extra` object.
4. `packages/proxy`-Config: `audit_extra_headers = ["X-Openape-Grant-Id"]`.

**Akzeptanzkriterien:**
- [ ] In ape-shell: nach Grant-Approval einer Zeile, Audit-JSONL enthält
      `X-Openape-Grant-Id` mit der korrekten Grant-ID.
- [ ] Tests in `packages/apes/src/shell/__tests__/wrap-line-env.test.ts`
      decken Quoting-Edge-Cases ab.

**Rollback:** Overlay-Helper zur identity-Funktion machen.

### Milestone 5: Audit-Surfacing in REPL

**Ziel:** User sieht direkt im REPL welche Egress-Calls geblockt wurden.

**Schritte:**
1. Audit-Stream-Mode im Proxy: zusätzlich zu File-Append einen ND-JSON-Output
   auf stdout (Flag `--audit-stdout`). ape-shell-Daemon liest stream.
2. orchestrator subscribed, formatiert als Inline-Status `[ape-shell] 🛡️ blocked CONNECT metadata.google.internal:443`.
3. `--quiet` respektieren (default: nur deny/grant_required surface'n, nicht plain allow).

**Akzeptanzkriterien:**
- [ ] `apes ape-shell -c "curl http://169.254.169.254/"` → user sieht `[ape-shell] 🛡️ blocked …`
      und curl-exit nicht-null.
- [ ] Allow-listed call: keine Zusatzzeile, normaler Output.

**Rollback:** Subscriber-Hook entfernen, Audit-File bleibt.

### Milestone 7 (optional, opt-in): Hard egress-enforcement via OS sandbox

**Ziel:** `apes proxy --strict -- <cmd>` zwingt das wrapped command auf
Kernel-Level — TCP-Egress nur zum lokalen Proxy-Port erlaubt, alles andere
(direct-socket-tools, raw curl mit ignoriertem env, ssh-protocol etc.) bekommt
ein hartes `connection-refused`. Wer nicht durch den Proxy will, kann nicht.

Ohne `--strict` bleibt M1a's "opt-in via env" Standard — 95% der CLI-Tools
respektieren ja `HTTPS_PROXY`/`ALL_PROXY` (M1a + Level-1-Followup), und das
ist meistens genug.

**Schritte:**
1. Plattform-Detection: macOS / Linux / Windows.
2. macOS: `sandbox-exec` mit Profile:
   ```scheme
   (version 1)
   (allow default)
   (deny network-outbound)
   (allow network-outbound (remote tcp "localhost:<proxy-port>"))
   (allow network-outbound (remote unix-socket))   ;; for syslog etc.
   ```
3. Linux: `unshare -n` + zwei `iptables`-Regeln im neuen Netzwerk-Namespace
   (DNAT zum Proxy oder REJECT alles außer Loopback). Heavier Setup, evtl.
   erst in M7b nachschieben.
4. Windows: aktuell nicht supported, klar dokumentieren.
5. `apes proxy --strict --` Flag in `commands/proxy.ts`. Default off.

**Akzeptanzkriterien:**
- [ ] macOS: `apes proxy --strict -- bash -c 'echo open ssh; ssh -o ConnectTimeout=2 github.com 2>&1'`
      → ssh schlägt mit "connection refused" fehl (statt sich zu verbinden), während
      `apes proxy --strict -- curl https://api.github.com/zen` weiter funktioniert.
- [ ] macOS: ohne `--strict` (M1a) funktionieren beide.

**Rollback:** Flag entfernen.

### Milestone 6: Tests, CI, Doku, Changeset

**Ziel:** Production-ready: green, dokumentiert, releasable.

**Schritte:**
1. Test-Coverage M1a-M5 prüfen, fehlende Kanten ergänzen (port-collision,
   proxy-crash-mid-session, slow shutdown, NO_PROXY-respektieren, daemon-reuse).
2. `packages/apes/README.md`-Section "Egress Mediation" mit Architektur-Diagramm.
3. `docs/cli/apes-proxy.md` final.
4. `.changeset/<name>.md`: `@openape/apes` patch + `@openape/proxy` patch.
5. `pnpm check` + `pnpm test` grün.
6. PR.

**Akzeptanzkriterien:**
- [ ] CI grün.
- [ ] Changeset korrekt.
- [ ] `npm view @openape/apes@<new-ver>` zeigt `@openape/proxy` als Dep.

**Rollback:** Revert-PR.

## Progress

> Laufend aktualisieren. Diese Section ist das Übergabedokument zwischen Sessions.

- [x] `[2026-04-27 21:40]` M0: `@openape/proxy` Node-build + dep-wiring (merged)
- [x] `[2026-04-27 22:10]` M1a: `apes proxy -- <cmd>` Subcommand (merged)
  - [x] `[2026-04-27 22:35]` Level-1 Followup: alle Proxy-env-var-Varianten setzen (`HTTPS_PROXY`/`https_proxy`/`HTTP_PROXY`/`http_proxy`/`ALL_PROXY`/`all_proxy`/`NO_PROXY`/`no_proxy`/`NODE_USE_ENV_PROXY=1`). Deckt Tools die nur lowercase oder `ALL_PROXY` lesen + Node 24+ native fetch.
- [x] `[2026-04-28 12:30]` M2: Host-based allow/deny/grant_required für HTTPS-CONNECT (merged) inkl. IdP-system-bypass + audience='ape-proxy' Rename + default_action='allow' Fix
- [x] `[2026-04-28 12:45]` M3 Foundation: per-audience YOLO + audience-bucket-registry (merged). Schema migrated, API back-compat, hook nutzt request.audience.
- [x] `[2026-04-28 13:00]` M3 UI: BucketYoloCard component + 4-Section layout auf `/agents/:email` (PR pending). Commands / Web / Root / Default jeweils eigene YOLO-Policy + Deny-Patterns.
- [ ] `[ … ]` M1b: ape-shell shared-daemon integration
- [x] `[2026-04-28 12:10]` M2: Host-based allow/deny/grant_required for HTTPS-CONNECT (PR pending)
  - Side-fix: `default_action="allow"` was previously type-invalid AND ignored by matcher (fall-through to grant_required). Type extended + matcher honors 'allow' as a hard-pass. Without this fix M2 would have made the M1a default permissive config block all unmatched HTTPS hosts.
- [ ] `[ … ]` M3: Ephemeral Agent-JWT für Proxy
- [ ] `[ … ]` M4: Per-Line Env-Overlay + Grant-Header
- [ ] `[ … ]` M5: Audit-Surfacing in REPL
- [ ] `[ … ]` M6: Tests + CI + Doku + Changeset + Release
- [ ] `[ … ]` M7 (opt-in): Hard egress-enforcement via OS sandbox (macOS sandbox-exec, Linux netns)

## Surprises & Discoveries

> Unerwartete Erkenntnisse während der Implementierung. Immer mit Evidenz.

- **2026-04-27 (M0):** dist-file ist `dist/index.js` (nicht `dist/cli.js` wie im Plan-Entwurf), weil tsup-entry `src/index.ts` heißt. Plan-Akzeptanzkriterien-Pfade entsprechend lesen. Evidenz: `node -e "console.log(require.resolve('@openape/proxy/package.json'))"` → `.../packages/proxy/package.json`, `bin['openape-proxy']` → `./dist/index.js`.
- **2026-04-27 (M0):** Audit-File schrieb keine Zeile bei einem allow-Request während Smoke-Test (`/tmp/openape-proxy-smoke-audit.jsonl` blieb leer trotz erfolgreichem `curl … api.github.com → HTTP 200`). Vermutung: Audit logged nur deny/grant_required, nicht plain allow. Außerhalb M0-Scope, beobachten in M5 (Audit-Surfacing).
- **2026-04-27 (M0):** `listen = "127.0.0.1:0"` in der TOML-Config geht zwar (server bindet auf zufälligen Port), aber das Log-Statement gibt fälschlich `Listening on http://127.0.0.1:0` aus statt der echten Port-Nummer. ~~Klein, kann später separat fixen.~~ **Fixed in M1a** (`packages/proxy/src/index.ts`, lese `server.address()` im listen-callback statt der konfigurierten Port-Zahl).
- **2026-04-27 (M1a):** Deny-Pfad gegen `169.254.169.254` blockt nicht aktiv mit fast-403 — curl läuft in den Timeout (28 connection-timed-out). Effekt-equivalent (Request kommt nicht durch), aber UX ist fuzzy. Vermutlich macht der Proxy keinen `early reject` auf CONNECT mit deny-host, sondern hängt die Verbindung. Beobachten in M2 (Config-Defaults) oder M3 (Auth + Härten); separater Followup-Issue möglich. Evidenz: `apes proxy -- curl http://169.254.169.254/...` → `curl: (28) Connection timed out after 3002 milliseconds`.

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|---|---|---|---|
| 2026-04-27 | Kein Subcommand `ape spawn` | Patrick: bestehende Bash-Wrapper-Architektur ist der natürliche Ort. | `ape spawn` als separates Subcommand. |
| 2026-04-27 | Kein MITM/CA-Inject | Vermeidet Truststore-Eingriff, kein Cert-Pinning-Bruch. Trade-off: nur Host-granular. | OneCLI-Style MITM. |
| 2026-04-27 | Default `default_action="allow"` in M1a, später härten in M3 | Schrittweises Rollout. | Direkt deny-by-default. |
| 2026-04-27 | Env-Var-Routing statt OS-Sandbox | TS-only, plattformneutral. | OS-Egress-Firewall. |
| 2026-04-27 | **`apes proxy -- <cmd>` als general-purpose Subcommand**, ape-shell nutzt es intern via shared daemon | Patrick (2026-04-27): spiegelt `apes run --root → escapes` Pattern, komponierbar außerhalb ape-shell, ssh-agent-style daemon-reuse. | In-process embedded proxy in ape-shell (verworfen weil weniger komponierbar + nicht analog zu existierender `escapes`-Architektur). |
| 2026-04-27 | **Stack bleibt TS/Node/Bun** für Proxy-Implementierung | Patrick: Einfachheit. Existing `@openape/proxy` ist TS, kein Sprachwechsel-Aufwand. | Rust (à la OneCLI) — verworfen wegen Toolchain-Burden + zweite Sprache im Stack. |
| 2026-04-27 | Daemon-Discovery via `OPENAPE_PROXY_URL`-env | ssh-agent / gpg-agent-Pattern, etabliert + verständlich. | Unix-domain-socket discovery; verworfen für M1, kann später nachrüsten. |
| 2026-04-27 | **Kein Autostart eines Proxy-Daemons in ape-shell.** ape-shell respektiert nur `OPENAPE_PROXY_URL` wenn der User die Var explizit gesetzt hat. | Patrick: User soll Lifecycle bewusst kontrollieren (`openape-proxy &`); ape-shell ist Konsument, kein Lifecycle-Owner. Keine impliziten Behavior-Änderungen für bestehende Sessions. | Auto-Spawn eines Session-Daemons (verworfen weil zu opaque + cleanup-fehleranfällig). |

## Session-Checkliste

> Jede Session beginnt mit dieser Checkliste:

1. Diesen Plan lesen, Progress + Surprises + Decision-Log durchgehen.
2. `git fetch origin && git log origin/main --since="last session" --oneline`.
3. `pnpm install` (lockfile-Drift fängt CI sonst spät).
4. Baseline-Test: `pnpm --filter @openape/apes test` muss grün starten.
5. Nächsten offenen Milestone identifizieren, Branch off main: `git checkout -b feat/apes-proxy-m<N>-<short>`.
6. Implementieren, Pre-commit hook akzeptieren.
7. E2E-Verifikation per Akzeptanzkriterien des Milestones (echter `apes proxy --`-Aufruf,
   echter HTTP-Call, echtes Audit-File-Inspect).
8. Progress-Section, Surprises (mit Evidenz), Decision-Log aktualisieren.
9. PR aufmachen, CI abwarten, mergen, Changeset (M6) zuletzt zusammen.
10. Bei Force-Push/`--admin` Bedarf: stop, frag Patrick.

## Outcomes & Retrospective

> Erst nach Abschluss aller Milestones ausfüllen.

- **Ergebnis:** *(tbd)*
- **Abweichungen vom Plan:** *(tbd)*
- **Learnings:** *(tbd)*
