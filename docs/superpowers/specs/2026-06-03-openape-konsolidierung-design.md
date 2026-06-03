# OpenApe-Konsolidierung — Design

**Datum:** 2026-06-03
**Status:** Freigegeben (Design), Phase 1 zur Planung
**Autor:** Brainstorming-Session "fresh-openape" (Patrick Hofmann + Claude)

---

## Kontext

Das OpenApe-Universum (~20 Repos + ein Monorepo mit 11 Apps & 14 Packages) ist
organisch gewachsen. Es deckt ab:

- **DDISA** — dezentrale, OIDC-ähnliche Anmeldung für Service-Provider (SPs)
- **Utility-SPs** in diesem Zusammenhang (tasks, plans, timetrack, chat, …)
- **Grants inkl. Escapes** — Human/Approver-in-the-Loop für Agents sowie
  menschliche/maschinelle Approver, zugleich sudo-Replacement
- **Protocol** — die normativen Spezifikationen dazu
- **Troop** — ein Ape-Agent-Spawn-Nest für den lokalen Rechner, aus dem Netz bedienbar
- **Org** — Meta-Tool über Troop, um sich eine Organisation aus Agenten zu bauen

Jede Iteration hat Altlast hinterlassen. Ziel dieser Kampagne: das Projekt
nachhaltig auf stabile Beine stellen, Weiterentwicklung und Einarbeitung
(auch durch Agents) vereinfachen, Qualität durch einfache, konkrete Tests heben.

---

## Befund des Survey (6 parallele Teams, 2026-06-02)

**Die Architektur-Knochen sind gesund. Die Krankheit ist Sediment + Spec-Drift,
nicht ein Architektur-Fehler.** Einstimmig über alle Teams:

- Schichtung `core → auth/grants → server → module → apps` ist sauber.
- Grants/Escapes-Trennung (TS-Server-Lib vs. Rust-setuid-Executor) ist **richtig**
  und soll **nicht** zusammengeführt werden.
- `@openape/nuxt-auth-sp` + `@openape/cli-auth` sind echte geteilte Libs.
- Kern-Test-Coverage ist solide (grants ~92 %, auth/core/proxy gut).

Fünf wiederkehrende Symptome:

1. **Jede Iteration hinterlässt Altlast.** `apps/idp` (kompletter alter IdP +
   eingecheckte `local.db`, in keiner CI), halbmigrierte Mac→Docker-Reste
   (launchd/plist, `~/Library/Application Support`-Pfade, launchd-Cron-Validator),
   `OPENAPE_BRIDGE_TARGET` fehlt in Docker-Bundles (neue Nests starten im falschen
   Chat-Backend), leeres `packages/shapes/`-Zombie-Verzeichnis, `soul`-Tombstone-
   Spalte, `openape-agent-proxy` ("Coming soon", deployed), `ape-tg-bridge` (tot),
   `test-deltamind-at` (redundant), Exoscale-Adapter wirft `"not yet wired"` bei
   live Endpoint.
2. **Spec-Drift — Specs sind NICHT die Source of Truth.** Implementierung führt,
   Doku hinkt. `ddisa_agent_*` (Spec) vs. `ddisa_auth_*` (Code) — bekannter Bug
   mit Test-Kommentar. `standing`-Grants (Prod-Feature) undokumentiert.
   `openape.json`-Manifest: Spec (Array) vs. Code (Record) strukturell
   inkompatibel. JSON-Schemas werden nirgends zur Validierung genutzt.
3. **SP-Boilerplate kopiert statt geteilt.** `ddisa-issuer.ts`, `problem.ts`,
   `cli-token.ts`, `require-auth.ts` **wortgleich** in tasks/plans/timetrack/chat.
   CLI-`api.ts`/`config.ts`/`output.ts` identisch über drei Repos. Nur das
   Frontend ist in der geteilten Lib, die Server-Seite nicht.
4. **Unscharfe Grenzen & Namenskollisionen.** `apes` ist 18k-LOC-Monolith
   (154 Dateien). `server-resolver.ts` dupliziert `apes/shapes/parser.ts`.
   `packages/proxy` vs. `apps/openape-agent-proxy` (fast gleicher Name,
   nichts gemein). "Nest" bedeutet drei Dinge.
5. **Drei parallele Auth-Implementierungslinien** — Web (nuxt-auth-sp),
   CLI (cli-auth), Desktop-Rust-PKCE (kennt niemand). → Die Desktop-Linie wird in
   M1 entfernt (Repo-Decommission), womit nur noch Web + CLI bleiben.

---

## Strategische Entscheidungen

1. **Konsolidierungs-Kampagne + Anti-Sediment-Prozess — kein Rewrite.**
   Ein Rewrite würde funktionierende Tests und saubere Schichtung wegwerfen und
   dieselbe Drift neu einfangen. Der Survey fand keinen Architektur-Fehler, der
   das rechtfertigt.
2. **Leitprinzip: Spec-Driven, Contract-Enforced.** Die `protocol/`-Specs +
   JSON-Schemas werden per CI gegen die echte Implementierung validiert. Drift =
   roter Test. Die Specs werden so geschrieben, dass ein Agent/Mensch das System
   allein daraus versteht. Heilt Drift + Onboarding + externe Interop in einem Zug.
3. **Fundament zuerst (Phase 1), Chirurgie als Phase 2.** Die riskante
   apes-Zerlegung/Renames bekommen eine eigene Phase **mit** den dann existierenden
   Contract-Tests als Sicherheitsnetz.

---

## North Star

> Ein neuer Agent oder Mensch versteht das OpenApe-System in unter einer Stunde,
> allein aus den Specs — und kann sich darauf verlassen, weil CI beweist, dass
> Code und Spec übereinstimmen.

---

## Phase 1 — Fundament (fünf session-große Milestones)

Reihenfolge ist bewusst: **M3 (das Netz) kommt vor jeder Phase-2-Chirurgie.**

### M0 — Baseline & Kill-Liste
- **Ziel:** Sicherer Ausgangspunkt + vollständiger Katalog des toten Codes.
- **Arbeit:** `pnpm turbo run build test` über das ganze Monorepo grün
  dokumentieren. Jeden toten Artefakt mit exaktem Pfad in `DELETION-MANIFEST.md`
  (Monorepo-Wurzel) katalogisieren.
- **Beweis:** Build+Test grün (Output festgehalten); `DELETION-MANIFEST.md` existiert
  und listet jeden Eintrag aus M1/M2 mit Pfad + Begründung + "nicht in CI/Deploy".

### M1 — De-Sedimentation (lösche, was beweisbar tot ist)
- **Ziel:** Beweisbar toten Code entfernen, ohne Verhalten zu ändern.
- **Arbeit:**
  - `apps/idp` (alter IdP) + `local.db` → löschen oder nach `examples/legacy-idp`.
    (Nachweislich in keiner CI/Deploy-Pipeline.)
  - `packages/shapes/` (leeres Zombie-Verzeichnis), `apps/idp/server/utils/idp-context.ts`
    (toter Re-Export), `log_error` in `escapes/src/audit.rs` (`#[allow(dead_code)]`),
    `escapes --update` (deprecated flag).
  - `apps/openape-agent-proxy` ("Coming soon", deployed) → löschen oder befüllen.
  - `ape-tg-bridge` archivieren; `test-deltamind-at` → Deploy-Branch von `openape-sp-starter`.
  - `desktop` (Tauri-App, abgebrochener Step-4-Effort) komplett entfernen/archivieren.
    Eliminiert zugleich die dritte Auth-Implementierungslinie (Desktop-Rust-PKCE) —
    übrig bleiben nur Web (`nuxt-auth-sp`) + CLI (`cli-auth`).
  - `soul`-Tombstone-Spalte + Boot-Migration in troop entfernen.
- **Beweis:** `pnpm turbo run build test` weiter grün; `grep -r` nach Zombie-Namen
  (`idp-context`, leeres shapes, `ape-tg-bridge`-Referenzen) leer; weniger Deploy-Targets.

### M2 — Mac→Docker-Migration abschließen
- **Ziel:** Das bereits begonnene Re-Framing zu Ende führen; Mac-first-Reste tilgen.
- **Arbeit:**
  - `OPENAPE_BRIDGE_TARGET=troop` in die Docker-Compose-Bundles
    (`nest/hatch.post.ts`, `pod/hatch.post.ts`).
  - Dualen Chat-Backend in `ape-agent` (`chat-api.ts` + `TroopChatApi`) auf troop-only reduzieren.
  - `~/Library/Application Support`-Pfade + launchd/plist-Referenzen entfernen
    (`bridge.ts`, `identity.ts`, `cron-runner.ts`); Cron-Validator auf Container-Kontext.
  - Legacy-Keypair-Auth-Pfad in `nest-ws.ts` entfernen.
  - Exoscale-`"not yet wired"`-Endpoint deaktivieren oder fertigstellen
    (live Endpoint der wirft ist gefährlicher als keiner).
- **Beweis:** frischer Docker-Nest spawnt, verbindet zu **troop** (nicht chat),
  läuft einen Cron-Task; `grep` nach `launchd`/`Library` nur noch absichtliche Treffer;
  abgeschlossene `MIGRATION-mac-to-docker.md` (siehe Anti-Sediment #4).

### M3 — Spec-Contract-Tests (Schlussstein des Leitprinzips)
- **Ziel:** Drift wird strukturell unmöglich, weil CI Spec vs. Code beweist.
- **Arbeit:**
  - Ajv-Test-Suite: emittierte Discovery-Docs, Grant-Objekte, AuthZ-JWTs gegen
    `protocol/schemas/*.json` validieren.
  - Sofort rote Tests auflösen (Code **oder** Spec angleichen, Entscheidung im
    Decision-Log dokumentieren):
    - `ddisa_agent_*` vs. `ddisa_auth_*` (Discovery-Feldnamen)
    - `standing` als `GrantCategory` in `grants.md` + `schemas/grant.json` aufnehmen
    - `scope` (singular) vs. `scopes` im AuthZ-JWT
    - `openape.json`-Manifest: Array- vs. Record-Format vereinheitlichen (eine Wahrheit)
    - `approver`-Claim + `ssh-key`-Auth-Methode dokumentieren
- **Beweis:** `pnpm test` enthält Contract-Tests, alle grün; ein absichtlich
  umbenanntes Discovery-Feld macht einen Contract-Test rot.

### M4 — SP-SDK (Tod der Boilerplate)
- **Ziel:** Server- + CLI-Boilerplate aus den Satelliten in geteilte Libs.
- **Arbeit:**
  - Server-Seite (`cli-token`, `ddisa-issuer`, `problem`, `require-auth`,
    `exchange.post`) in `@openape/nuxt-auth-sp`, parametriert über `openapeSp`-Config.
  - CLI-Factory `createSpClient({ defaultEndpoint, envVar, configFile, defaultAud })`
    in `@openape/cli-auth` (+ geteiltes `output.ts`).
  - tasks/plans/timetrack/chat migrieren; wortgleiche Kopien löschen.
- **Beweis:** die 4 wortgleichen Dateien sind aus allen Satelliten weg; SP-Tests grün;
  ein neuer SP-CLI ist deutlich kleiner.

---

## Anti-Sediment-Prozess (Heilung gegen Wiederkehr)

Macht Sediment **sichtbar und ablaufdatiert** statt vergraben:

1. **Contract-Tests als Merge-Gate** (aus M3). Spec und Code auseinanderlaufen
   lassen = roter CI.
2. **`// REMOVE-AFTER: <version|datum>`-Regel mit Zahn.** Jeder Legacy-/Compat-Shim
   trägt das Tag; ein CI-Check failt bei überschrittenem Datum. (Survey fand mehrere
   deadline-lose "#stage-3 cleanup"-Kommentare + Legacy-Auth-Pfad "kept until cut
   over" ohne Datum.)
3. **`DEPRECATIONS.md`-Ledger** an der Monorepo-Wurzel — ein Ort für jeden Shim,
   jede Tombstone-Spalte, jeden Legacy-Pfad mit Entfernungs-Trigger.
4. **`MIGRATION-<name>.md`-Abschluss-Gate.** Re-Framings (wie Mac→Docker) erzeugen
   ein Checklisten-Artefakt, das erst schließt, wenn `grep` den alten Ansatz tot
   beweist. M2 produziert die erste solche abgeschlossene Migration.
5. **`protocol/ARCHITECTURE.md`** — eine Seite: Dependency-Graph + "was ist was" +
   "wo fange ich an". Von den Contract-Tests referenziert, damit Onboarding-Doku und
   Wahrheit dasselbe Artefakt sind.

---

## Phase 2 — Skizze (strukturelle Chirurgie, mit M3-Netz)

Noch nicht im Detail geplant; nach Phase 1, abgesichert durch Contract-Tests:

- `apes`-Monolith (18k LOC/154 Dateien) in Module mit klaren Grenzen zerlegen.
- `@openape/shapes` als echtes Paket extrahieren — löst `server-resolver.ts` ↔
  `apes/shapes/parser.ts`-Duplikat **und** das Zombie-Verzeichnis in einem.
- Namenskollisionen auflösen: `packages/proxy` vs. `apps/openape-agent-proxy`;
  "nest"-Dreifachbedeutung.
- Grenzen schärfen: `auth` vs. `server`; Insel-Pakete (`browser`, `s3-driver`,
  `prompt-injection-detector`) inlinen oder als echte Standalone positionieren.
- `approveGrantWithExtension` vs. `approveGrantWithWidening` zusammenführen.

> Hinweis: Die ursprünglich hier vorgesehene Konsolidierung der dritten Auth-Linie
> (Desktop-Rust-PKCE) entfällt — die `desktop`-App wird bereits in M1 entfernt.

---

## Nicht im Scope

- Vollständiger Rewrite (verworfen, siehe Strategische Entscheidung 1).
- Zusammenführung von Grants und Escapes (Trennung ist korrekt).
- Neue Features. Diese Kampagne ist reine Konsolidierung + Stabilisierung.

---

## Risiken & Rollback

- Jeder Milestone ist eigenständig per Git-Commit-Checkpoint abgesichert.
- M1-Löschungen sind idempotent und über Git wiederherstellbar; nichts Deployedtes
  wird ohne `grep`-Beweis "nicht in CI" entfernt.
- M3 deckt vor der Phase-2-Chirurgie ab — die riskanten Umbauten haben dann ein Netz.
- Baseline-Test (M0) vor jeder Änderung verifiziert bestehende Funktionalität.
