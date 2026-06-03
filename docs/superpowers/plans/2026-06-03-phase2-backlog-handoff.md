# OpenApe-Konsolidierung — Phase-2-Backlog & Handoff

**Datum:** 2026-06-03. Übergabe nach Abschluss von Phase 1 (M0–M4) + erstem Phase-2-Item.
Design: `docs/superpowers/specs/2026-06-03-openape-konsolidierung-design.md`.

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
