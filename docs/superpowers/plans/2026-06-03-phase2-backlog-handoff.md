# OpenApe-Konsolidierung — Phase-2-Backlog & Handoff

**Datum:** 2026-06-03. Übergabe nach Abschluss von Phase 1 (M0–M4) + erstem Phase-2-Item.
Design: `docs/superpowers/specs/2026-06-03-openape-konsolidierung-design.md`.

---

## ✅ ABSCHLUSS-STAND 2026-06-04 (lies das zuerst)

Die Kampagne ist im Kern **abgeschlossen**. Stand:

- **Phase 1 vollständig:** M0/M1/M3/M4 ✅; **M2 end-to-end** ✅ — Cutover-Removal gemerged (#554) + `node scripts/deploy.mjs troop` **live deployed** (verifiziert: mbp-home reconnected post-restart via device-token, troop healthy). Mac→Docker durch.
- **Phase 2:** ✅ `OpenApeManifest`-Array-Fix · shape-matcher · **`@openape/shapes@0.7.x`** + **`@openape/agent-runtime@0.2.x`** extrahiert+publiziert · Agent-`http`-SSRF-Guard · SSRF-Guard nach `@openape/core` dedupliziert (Single Source).
- **apes-Decompose: ABGESCHLOSSEN erklärt** (2026-06-04). Die zwei sauber separierbaren Libs sind raus (apes ~18k→~14k LOC). Der Rest — `commands/` + `shell/` (CLI-Oberfläche) und die `host-platform/`-Abstraktion + `agent-bootstrap` (live, darwin für Mac-Nests + linux für Docker, eng mit den agents-Commands verwoben) — ist der **irreduzible CLI-Kern**, bewusst NICHT weiter extrahiert (sinkender Nutzen, steigende Verflechtung).
- **Releases:** alle git↔npm synchron, **0 offene Changesets**. ~20 Pakete publiziert.

### Genuin verbleibend (optional/future)
- **`approveGrantWithExtension` vs `approveGrantWithWidening`** (grants) zusammenführen — braucht eine Semantik-Entscheidung (welche Variante gewinnt); grants ist prod-kritisch.
- **„nest"-Dreifachbedeutung** dokumentieren/auflösen.
- **`host-platform/` als `@openape/host-platform`** wäre der einzige semi-saubere Rest-Schnitt, falls je gewünscht (interface-basierte darwin/linux-Abstraktion, ~600 LOC; agent-bootstrap hängt dran).
- **SSRF-Residual:** Redirect-/DNS-Rebinding-Härtung via pinned-IP-Fetch / jose-v6 `customFetch`.

### Bekannte Harness-Grenze
Der Auto-Mode-Classifier blockt agent-seitige **Prod-DB-SSH-Reads** (auch mit Chat-Freigabe + `apes run`-Wrapper) — braucht eine Bash-Permission-Rule in `.claude/settings.local.json` (vom User anzulegen; Agent darf sich nicht selbst freischalten). **Deploy-Scripts** (`node scripts/deploy.mjs <t>`) laufen dagegen durch.

---

## Phase-1-Status: ✅ komplett (bis auf cutover-gated Rest in M2)
- **M0/M1** De-Sedimentation, **M3** Spec-Contract-Netz + protocol-Reconciliation, **M4** SP-SDK fleet-weit (Libs publiziert, chat + tasks/plans/timetrack migriert, SSRF gehärtet), **M2** safe slice (Hatch-Bundle-Bugfix, Exoscale-501, launchd-Kommentare, REMOVE-AFTER-Tags + `MIGRATION-mac-to-docker.md`).
- Erstes Phase-2-Item erledigt: `OpenApeManifest.scopes` (core) Record→Array (IdP-seitiges B6 behoben, PR #546).

## ⏳ Offene operative Items (kein Refactor, klar definiert)

### 1. Core-Republish steht aus (cascadiert)
Eine Changeset liegt auf `main`: `@openape/core` patch (manifest-scopes Array-Fix). `@openape/core` wird von **allen** Paketen konsumiert → `pnpm version-packages` bumpt core + ~alle Dependents, `pnpm release` publisht entsprechend viele Pakete. Monorepo-Apps (free-idp etc.) haben den Fix schon via `workspace:*`; **externe** Konsumenten brauchen den Republish. → Batchen (mit dem nächsten core-relevanten Change) oder gezielt auslösen. Befehl: im Monorepo-Root `pnpm version-packages && pnpm release` (npm-Auth als `patrick-hofmann` vorhanden).

### 2. M2 cutover-gated Removals (Prod-Verifikation nötig)
Getaggt mit `// REMOVE-AFTER: cutover-verified`, dokumentiert in `MIGRATION-mac-to-docker.md`. Vor dem Entfernen prüfen (troop-Prod-DB auf chatty, read-only):
- Nutzen Live-Nests noch Legacy-Keypair (`act:agent`) statt Device-Token? `SELECT count(*) FROM nests WHERE device_secret_hash IS NULL;` (0 ⇒ Legacy-Pfad in `nest-ws.ts` entfernbar).
- Läuft noch ein Agent auf dem alten Chat-Backend (`chat.openape.ai`) statt troop?
Wenn beides negativ: ape-agent dualen Chat-Backend (`ChatApi`/`chat-api.ts`) + `OPENAPE_BRIDGE_TARGET ?? 'chat'`-Default + `~/Library`-Pfade entfernen, `nest-ws.ts` Legacy-Auth entfernen.
→ Prod-DB-Zugriff wurde dem Agent verweigert; braucht Freigabe oder manuelle Prüfung durch Patrick.

## 🔨 Phase-2-Refactors (je eigene Brainstorm/Plan-Session — NICHT ad-hoc)

### A. Shapes-Resolver-Konsolidierung (Survey-Top-Duplikat — aber kein Copy-Paste)
`packages/grants/src/server-resolver.ts` (300 LOC, über `ServerShape`/`ShapeStore`) und `packages/apes/src/shapes/parser.ts` (227 LOC, über `LoadedAdapter`/TOML) sind **zwei Resolver desselben Algorithmus** (argv → Operation → canonical permission) über **verschiedene Datenmodelle**. Die Primitive (`canonicalizeCliPermission`/`computeArgvHash`) ist bereits geteilt (parser importiert aus `@openape/grants`). Echte Dedup erfordert eine **Design-Entscheidung**: ServerShape- und LoadedAdapter-Modell vereinheitlichen ODER einen generischen, über beide parametrisierten Resolver extrahieren (Kandidat: `@openape/shapes` als echtes Paket). Mittlere Größe, berührt 2 publizierte Pakete + den IdP → eigene Planung, M3-Netz als Absicherung.

### B. apes-Monolith zerlegen
`packages/apes` = 154 Dateien / ~18k LOC (CLI + MCP-Server + Shell-Runner + Shapes + Grant-Orchestration + SSH + Proxy). In Module mit klaren Grenzen schneiden. Größtes Item, eigene Planung zwingend.

### C. Kleinere, contained Items
- **`OpenApeScope`-Interface in core** ist seit PR #546 ungenutzt (Array-Items inline typisiert) → entfernen (trivial).
- **`approveGrantWithExtension` vs `approveGrantWithWidening`** (grants) zusammenführen — zwei überlappende Approve-Varianten, beide in Prod (IdP nutzt beide) → vorsichtig, mit Tests.
- **timetrack `ddisa-issuer.ts`-Dedup**: lokale Kopie nur wegen Test-Import behalten → Test auf `@openape/nuxt-auth-sp`-Import umstellen, lokale Datei löschen (beseitigt 4 „Duplicated imports"-Warnungen). Externer Repo, kein Publish nötig.
- **SSRF-Residual** (`nuxt-auth-sp`): Redirect-Refusal + DNS-Rebinding-Schutz via pinned-IP-Fetch / jose-v6 `customFetch` (jose 5.10 kann es nicht).
- **Namenskollision/„nest"-Dreifachbedeutung** dokumentieren/auflösen (Container vs `nests`-Tabelle vs Mac-Daemon-Altbegriff).

## Anti-Sediment-Status
Contract-Netz (`@openape/protocol-conformance`) fängt Spec-Drift im Gate. `DELETION-MANIFEST.md` + `MIGRATION-mac-to-docker.md` + `// REMOVE-AFTER`-Tags tracken Altlast sichtbar. Die heutige Migration hat zwei vorbestehende Bugs (SSRF, IdP-Manifest-Record) aufgedeckt+behoben statt neue Altlast zu hinterlassen — das Prinzip wirkt.
