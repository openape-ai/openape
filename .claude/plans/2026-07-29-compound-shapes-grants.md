# Plan: Compound-Kommandos segmentweise durch Shapes (Mail-Grant-Abstraktion)

> Dieser Plan ist self-contained: ein Agent ohne Vorwissen kann ihn von oben
> nach unten ausführen. Arbeits-Checkout ist der Worktree
> `~/Companies/private/repos/openape/openape-monorepo.worktrees/idp-design-system`
> (steht auf main); der Primary-Checkout ist multi-agent shared — dort nicht arbeiten.

## Purpose / Big Picture

- **Ziel:** Patrick bekommt für Mail-Arbeit seines Operators nicht mehr eine
  Approval-Karte **pro Mail**, sondern kann einmal „Mail lesen erlauben — 24h /
  7 Tage / immer" entscheiden. Approval-Karten zeigen strukturierte Operationen
  („Read email X from account Y, risk low") statt roher `bash -c`-Strings.
- **Kontext:** Der Worker (codex-Backend via ape-shell) schickt praktisch immer
  Compound-Shell (`o365-cli mail list --json | jq …`, `a && b`). Eine einzige
  Zeile — `if (parsed.isCompound) return false` in
  `packages/apes/src/commands/run.ts:484` — wirft ALLE diese Kommandos aus dem
  Shapes-Adapter-Pfad in den opaken Session-Grant-Pfad. Dort gibt es keine
  `authorization_details`, also können Standing Grants (die komplette
  Abstraktions-Maschinerie: Wildcard-Templates, `max_risk`, timed/always,
  Widening-UI) nie matchen. Übrig bleiben nur die viel zu grobe
  „Session-Grant"-Reuse (Agent darf ALLES auf dem Host) und YOLO-Globs in
  `bash -c`-Doppelform.
- **Scope:**
  - Drin: Segment-Splitting nach @openape/core extrahieren; ape-shell löst
    Compound-Zeilen segmentweise auf und schickt EINEN Grant-Request mit der
    Vereinigung der Details; Grant-Approval-UI bekommt „daraus eine Regel
    machen" (Standing Grant mit Dauer, aus dem Request abgeleitet).
  - Explizit NICHT drin: Änderungen an der YOLO-Policy-Logik (bleibt wie sie
    ist), neue Adapter (o365.toml existiert und ist gut), Worker-Prompt-Tuning.

## Repo-Orientierung

- **Projekt:** openape-monorepo (pnpm + Turborepo), Worktree s. o.
- **Relevante Dateien:**
  - `apps/openape-free-idp/server/utils/yolo-evaluator.ts` —
    `splitCommandSegments` + `containsCommandSubstitution` (quote-sicher,
    #1079-gehärtet, Tests in `apps/openape-free-idp/tests/`). WANDERT nach core.
  - `packages/core/src/` — Ziel für die extrahierte Splitter-Logik.
  - `packages/shapes/src/shell-parser.ts` — `parseShellCommand` (setzt
    `isCompound`), `extractShellCommandString` (entpackt `bash|sh -c`).
  - `packages/shapes/src/generic.ts` — `buildGenericResolved`: unshaped
    Segment ⇒ `risk: 'high'`, `exact_command: true`, `argv_hash`-Bindung.
  - `packages/apes/src/commands/run.ts` — `runShellMode` (Z. ~336) +
    `tryAdapterModeFromShell` (Z. ~474, dort das `isCompound`-Bail),
    `execShellCommand`.
  - `packages/apes/src/shapes/grants.ts` — `createShapesGrant`,
    `findExistingGrant`, `fetchGrantToken`, `verifyAndConsume`,
    `verifyAndExecute` (führt EIN resolved Kommando aus — für Compound
    ungeeignet, s. Milestone 2).
  - `packages/grants/src/standing-grants.ts` — `evaluateStandingGrants`
    (verlangt schon heute: Template deckt JEDES incoming Detail; Punkte 1–9 im
    Docstring). `packages/grants/src/cli-permissions.ts` —
    `mergeCliAuthorizationDetails`, `cliAuthorizationDetailCovers`,
    `widenCliAuthorizationDetail`.
  - `modules/nuxt-auth-idp/src/runtime/pages/grant-approval.vue` — Approval-
    Karte. `modules/nuxt-auth-idp/src/runtime/server/api/standing-grants/index.post.ts`
    — Standing-Grant-Anlage (existiert).
  - Referenz-Adapter: `~/.openape/shapes/adapters/o365.toml` (mail.read/list/
    search = low; send/trash = high).
- **Tech-Stack:** TypeScript, Vitest, Nuxt 4 (Modul-UI), h3.
- **Dev-Setup:**
  - Tests: `pnpm turbo run test --filter=@openape/core --filter=@openape/shapes --filter=@openape/apes --filter=@openape/grants --filter=@openape/nuxt-auth-idp`
  - IdP lokal (in-memory, gated Seiten screenshotbar): siehe Memory
    `idp-auth-gated-screenshot-harness` — `NUXT_TURSO_URL=file::memory:` +
    Cookie-Minting; Harness liegt unter dem Session-Scratchpad
    (`…/scratchpad/harness/`), bei Bedarf neu aufsetzen.
  - Gates vor Commit: `pnpm lint` → `pnpm typecheck` → betroffene Tests.

## Milestones

### Milestone 1: Splitter nach @openape/core, konsumiert von IdP + shapes

**Ziel:** `splitCommandSegments` + `containsCommandSubstitution` leben genau
einmal, in `@openape/core`; free-idp und shapes importieren sie. Kein
Verhaltensunterschied.

**Schritte:**
1. `packages/core/src/shell-segments.ts` neu: beide Funktionen 1:1 aus
   `apps/openape-free-idp/server/utils/yolo-evaluator.ts` übernehmen, exportieren
   über `packages/core/src/index.ts`.
2. Bestehende Unit-Tests der beiden Funktionen aus den free-idp-Tests nach
   `packages/core/test/shell-segments.test.ts` kopieren (Tests zuerst laufen
   lassen: rot ohne Implementierung, grün danach).
3. free-idp: `yolo-evaluator.ts` importiert aus `@openape/core` und re-exportiert
   (bestehende Importe im App-Code + Tests bleiben gültig).
4. `scripts/publish-chain.mjs`: prüfen, dass core vor shapes/apes steht (steht
   es als Wurzel ohnehin) — KEIN neuer Eintrag nötig, core ist schon drin.

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=@openape/core` → neue Splitter-Tests grün
- [ ] `pnpm turbo run test --filter=openape-free-idp` → YOLO-Tests unverändert grün (insb. die #1079-Fälle)
- [ ] `grep -rn "function splitCommandSegments" apps/ packages/` → genau EIN Treffer (core)

**Rollback:** Commit revert; free-idp behält seine lokale Kopie.

### Milestone 2: ape-shell löst Compound-Zeilen segmentweise auf

**Ziel:** `ape-shell -c "o365-cli mail list --json | jq -r '.[].id'"` erzeugt
EINEN Grant-Request mit `authorization_details` = [o365 mail.list (low),
generic jq (high, argv-gebunden)] statt eines opaken Session-Grants. Nach
Approval wird die Original-Zeile unverändert als Ganzes ausgeführt.

**Schritte:**
1. Test zuerst (`packages/apes/test/compound-resolve.test.ts`): für eine
   Compound-Zeile aus 2 Segmenten wird der Request-Body mit gemergten Details
   gebaut; Zeilen mit Command-Substitution in irgendeinem Segment fallen auf
   den opaken Pfad zurück (fail closed, konsistent zu #1079); `apes`-Self-
   Dispatch-Segmente (`apes grants status …`) bleiben vom Grant-Flow
   ausgenommen wie bisher.
2. `packages/shapes`: neue Funktion `resolveCompoundCommand(innerLine)`:
   - `splitCommandSegments(innerLine)` (aus core);
   - Abbruch (return null) wenn irgendein Segment `containsCommandSubstitution`;
   - pro Segment `parseShellCommand` → Adapter via `loadOrInstallAdapter` →
     `resolveCommand`, sonst `buildGenericResolved` (Segment-argv);
   - Ergebnis: `{ resolvedSegments: ResolvedCommand[], details: mergeCliAuthorizationDetails(...) }`.
3. `packages/apes/src/commands/run.ts` `tryAdapterModeFromShell`: der
   `isCompound`-Bail ruft stattdessen `resolveCompoundCommand` auf. Request via
   `createShapesGrant`-Erweiterung (akzeptiert mehrere Details;
   `execution_context.argv` = das ORIGINALE `['bash','-c',line]`, plus
   `compound: true`-Marker).
4. Ausführung nach Approval: NICHT `verifyAndExecute` (führt ein einzelnes
   resolved Kommando aus) — neuer Pfad `verifyAndExecCompound`: Token holen,
   `verifyAndConsume` gegen ALLE Details, dann `execShellCommand(originalArgv)`
   (Pipes/&& müssen als Shell-Zeile laufen). Generic-Audit-Log pro generic
   Segment wie in `verifyAndExecute` (`appendGenericCallLog`).
5. Grant-Reuse: `findExistingGrant` auf Multi-Detail erweitern — ein
   bestehender approved timed/always-Grant (oder Standing-Grant-Auto-Approve
   serverseitig, das tut der IdP schon) deckt den Request, wenn er alle Details
   abdeckt.
6. IdP-Seite: KEINE Server-Änderung nötig — `evaluateStandingGrants` deckt
   Multi-Detail-Requests bereits ab (Docstring Punkt 8: „for EVERY incoming
   detail"). Verifizieren per Test in `packages/grants` (Standing Grant
   `o365 / account:email=* / mail:* / action read|list|search / max_risk low`
   deckt den Request aus Schritt 1 NICHT ab, solange das jq-Segment high ist —
   siehe Entscheidung unten — und deckt ihn ab, wenn der Request nur
   o365-Details enthält).

**Entscheidung (im Plan festgehalten, betrifft UX):** Ein generisches Segment
(`jq`, high) verhindert Standing-Grant-Auto-Approve für die ganze Zeile. Das
ist gewollt fail-closed. Damit die Mail-Abstraktion trotzdem greift, bekommen
bekannte harmlose Filter-Tools (jq, grep, head, tail, wc, sort, cut, awk ohne
system()) eigene Low-Risk-Adapter-TOMLs im Registry-Repo — SEPARATER
Follow-up, nicht dieser Plan. Bis dahin gilt: reine o365-Ketten (`o365-cli … &&
o365-cli …`) werden voll abgedeckt; Pipes durch jq erzeugen weiter eine Karte,
aber eine strukturierte mit klarer Ursache („jq unshaped, high").

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=@openape/apes --filter=@openape/shapes --filter=@openape/grants` → grün, inkl. neuer Tests
- [ ] Manuell gegen lokalen IdP (Harness): `ape-shell -c "o365-cli mail list && o365-cli mail read X --account Y"` → EINE Approval-Karte mit 2 strukturierten Details; nach Anlage eines Standing Grants (`mail:*`, read+list, low, timed 1h) → Folge-Aufruf läuft OHNE Karte durch (Server-Log: `auto_approval_kind: 'standing'`)
- [ ] Zeile mit `$(…)` in einem Segment → weiterhin opaker Pfad (Karte wie heute), KEIN Auto-Approve

**Rollback:** Feature-Commit revert; der alte `isCompound`-Bail ist der
Fallback-Pfad und bleibt als solcher bestehen (Substitution-Fälle laufen eh
darüber).

### Milestone 3: „Daraus eine Regel machen" auf der Approval-Karte

**Ziel:** Auf `/grant-approval` kann Patrick aus einem strukturierten Request
per Klick einen Standing Grant ableiten: Vorschau „o365: mail [*] — read/list/
search, risk ≤ low", Dauer 24h / 7 Tage / immer, dann approve wie gehabt.

**Schritte:**
1. `modules/nuxt-auth-idp/src/runtime/pages/grant-approval.vue`: wenn der
   Request `openape_cli`-Details hat, Sektion „Regel für die Zukunft" rendern:
   pro cli_id ein Vorschlag aus `widenCliAuthorizationDetail` (id-Selektoren →
   `[*]`), Aktionen = Vereinigung der Detail-Actions, `max_risk` = max der
   Detail-Risks. Duration-Auswahl: 24h / 7d / always.
2. Bei Bestätigung: `POST /api/standing-grants` (Endpoint existiert) mit dem
   Template, danach normaler Approve des anstehenden Grants. UI-Stil: bestehende
   Design-Tokens (IdpHero/Karten aus #1092), Labels MIT `for`-Attribut (Audit-
   Fund D5 nicht wiederholen).
3. Test: bestehende `modules/nuxt-auth-idp/test/grant-pages.test.ts` um den
   neuen Flow erweitern (mount, Vorschlag sichtbar, POST-Body korrekt).

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=@openape/nuxt-auth-idp` → grün
- [ ] Screenshot-Beweis (lokaler Harness, `pendingConsent`-analoges Seeding
  eines pending Grants): Karte zeigt Regel-Vorschau; nach Klick existiert der
  Standing Grant (`GET /api/standing-grants`) und der nächste gleichartige
  Request wird auto-approved
- [ ] `pnpm lint` + `pnpm typecheck` monorepo-weit grün

**Rollback:** UI-Commit revert; Server unangetastet.

### Milestone 4: Release + Deploy + Beweis am echten Operator

**Ziel:** Der Fix erreicht Patricks Maschine (apes-CLI via npm) und id.openape.ai.

**Schritte:**
1. Changesets für @openape/core, @openape/shapes, @openape/grants,
   @openape/apes, @openape/nuxt-auth-idp (`pnpm changeset`, patch/minor je
   Umfang) → `pnpm version-packages` → PR → `pnpm release` (lokal, npm-Login).
2. `pnpm run deploy:image free-idp` aus dem main-Worktree (Ancestor-Guard
   beachtet das selbst).
3. `npm i -g @openape/apes@latest` auf dem Mini; Operator-Lauf beobachten:
   ein Mail-Triage-Durchgang, dann Standing Grant über die neue UX anlegen,
   nächster Durchgang ohne Karten für Lese-Operationen.

**Akzeptanzkriterien:**
- [ ] Echter Operator-Lauf: Lese-Kommandos erzeugen KEINE Approval-Karten mehr,
  Schreib-/Send-Kommandos (`mail.send`, high) weiterhin JA
- [ ] `apes grants list` (bzw. IdP `/grants`) zeigt den Standing Grant mit Ablauf

**Rollback:** npm: vorherige apes-Version pinnen; IdP: `deploy:image` rollt bei
rotem Health-Gate selbst zurück, sonst `<APP>_TAG_PREV` redeployen.

## Progress

- [x] `[2026-07-29]` Plan geschrieben
- [x] `[2026-07-29]` **RICHTUNGSWECHSEL (Patrick):** bash -c wird auf
  Hook-Ebene im IdP ausgepackt statt ape-shell/shapes umzubauen — die App
  bleibt leichter; Compound (`|`, `&&`) ist durch die bestehende
  #1079-Segmentierung im Hook-Pfad bereits abgedeckt. Umgesetzt in
  `targetFromRequest` (+ `outerTarget`-Schutz für Alt-Deny-Patterns in
  äußerer Form), Branch `fix/yolo-bash-c-unwrap`. Milestones 1–2 damit
  OBSOLET für den Schmerzpunkt; M3 (Regel-UX am Approval) und der
  strukturierte Shapes-Ausbau bleiben als optionaler späterer Ausbau.
- [x] `[2026-07-29]` **RICHTUNGSENTSCHEID (Patrick, nachmittags):** Shapes ist
  der Weg — „ein guter Weg, sicher die richtigen Scopes setzen zu können".
  Wildcards/Patterns bleiben als gleichberechtigter Shape-less-Fallback
  erhalten (Architekturprinzip, keine Übergangslösung). Milestones 1–3
  REAKTIVIERT; der Hook-Unwrap (deployed, prod-4ff1cddc) bleibt als
  Pattern-Schiene bestehen und wird NICHT zurückgebaut.
- [x] `[2026-07-29]` Milestone 1: Splitter nach @openape/core — PR #1095
  (feat/core-shell-segments), Tests 15 (core) + 77 (IdP) grün, Changeset
  core minor. Wartet auf CI + Merge.
- [x] `[2026-07-29]` Milestone 2: ape-shell Compound segmentweise — PR #1096
  (feat/shapes-compound, gestackt auf #1095). resolveCompoundCommand in
  shapes, createCompoundGrant/verifyAndConsumeCompound/Reuse in apes,
  sudo-Segmente + Substitution + Redirects + gemischte Audiences fail-closed.
  **Fund dabei:** evaluateStandingGrants war Single-Grant-covers-all — ein
  o365+jq-Compound konnte NIE auto-approven (cli_id-Regel deckt fremdes
  Detail nicht). Fix: Union-Semantik über mehrere Standing Grants, Filter
  pro Regel gegen die von ihr gedeckten Details (Commit 42b32577, Test
  beweist beide Richtungen).
- [x] `[2026-07-29]` Milestone 3: Regel-Vorschlag auf der Approval-Karte —
  PR #1098 (feat/approval-rule-ux). Template: erster Resource-Link behält
  Selector, Rest wildcard; max_risk = höchstes Incoming-Risk (Adapter-
  Risk-Stufen übernehmen Verb-Gating); Dauer 24h/7d/immer. Generic-only
  ohne Vorschlag. Nebenfund: TS-Casts in USelect/UInput-Test-Stubs.
- [x] `[2026-07-29]` Milestone 4: Release + Deploy + Live-Beweis — PR #1101
  (version packages), 13 Pakete auf npm (core 0.20.0, grants 0.13.0,
  shapes 0.9.0, apes 1.34.0, nuxt-auth-idp 0.33.0 + Dependents),
  free-idp `prod-a556003c`, apes am Mini auf 1.34.0 (pnpm-global, NICHT
  npm -g — siehe [[mac-node-toolchain]]).
  **Live-Beweis (Delta-Mind-Operator, echte Pipe):**
  `bash -c o365-cli mail list --account … --json | jq length`
  → `used, auto=standing, sg=e5dc03ba`,
  `details: ['o365:mail.list/low', 'jq:filter.stdin/low']` — keine Karte.
  Falle bestätigt: der Worker-Log sagt trotzdem „wartet auf Grant-Freigabe"
  (ape-shell ohne APE_WAIT, siehe [[operator-mail-kalender-betrieb]] Falle 4)
  — der Grant-Record ist die Wahrheit.
- [x] `[2026-07-30]` Rollout auf IURIO + privat: `jq`/`jq *` in die
  Mail-Rollen-`tools` beider Firmen, je zwei Standing Grants (7 Tage,
  max_risk low): IURIO `o365` (1ee47292) + `jq` (1aff73cf), privat
  `gmail` (eedbb528) + `jq` (d1034b65). privat trägt der neue
  gmail-Adapter aus M5. Worker setzt `HOME` nicht um (nur APES_AUTH_FILE
  je Org), Adapter aus `~/.openape/shapes/adapters/` gelten also für alle
  Operatoren.
- [x] `[2026-07-29]` **Milestone 5: Adapter-Hygiene der Registry** — LIVE
  (shapes-registry@523f76f auf GitHub): gmail.toml (17 Ops, o365-Muster),
  jq.toml (bewusst stdin-only — alle dateilesenden Formen fallen
  konstruktionsbedingt auf Generic/high; 10 Smoke-Fälle gegen den echten
  Matcher grün), 26 Adapter ohne Risiko-Gefälle entfernt inkl. awk/sed
  (system()/-i deklarativ nicht ehrlich abbildbar). Rest der alten
  M5-Beschreibung: —
  `openape-ai/shapes-registry`: (a) `gmail.toml` nach o365-Muster (read low /
  edit medium / send+trash high; gmail-cli ist himalaya-Wrapper, Kommandos aus
  `gmail-cli --help` ableiten), (b) `jq.toml` (reines Filter-Tool, kein Exec →
  alles low, KEIN exact_command), (c) coreutils-Adapter entfernen (cat, ls,
  echo, uname, whoami, env, du, df, date, diff, cut, cp …) — Generic-Fallback +
  Patterns decken sie ab, jeder Adapter ist Pflege-/Supply-Chain-Fläche.
  awk/sed bekommen bewusst KEINEN Low-Risk-Adapter (awk system(), sed -i).

**Bekannte Grenze des Hook-Unwraps:** die Risk-Threshold-Schiene
(`resolveServerShape`) sieht weiterhin `bash` (→ high) statt des inneren
Kommandos — Auto-Approve über Risk-Schwelle greift für gewrappte Kommandos
nicht, nur über Allow-Patterns. Fail-closed, bewusst nicht ausgebaut.

## Surprises & Discoveries

- 2026-07-29: Die gesamte Abstraktions-Maschinerie (Standing Grants mit
  Wildcards, max_risk, timed/always, Widening) existiert und funktioniert —
  Mail-Requests erreichen sie nur nie, weil `run.ts:484` Compound-Zeilen
  vor der Shape-Auflösung aussortiert. Evidenz: o365.toml deckt mail.read
  als low ab; `evaluateStandingGrants` Docstring Punkt 8.

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-07-29 | Splitter nach @openape/core, nicht duplizieren | #1079-gehärtete Logik, ein Drift-Punkt weniger; core ist gemeinsame Wurzel | Kopie in shapes (Drift), Import IdP→shapes (falsche Richtung) |
| 2026-07-29 | Compound-Ausführung = Original-Zeile als Ganzes nach Multi-Detail-Verify | Pipes/&& brauchen die Shell; segmentweise Ausführung würde Semantik ändern | Per-Segment-Exec (bricht Pipes) |
| 2026-07-29 | Generic-Segmente bleiben high + argv-gebunden | Fail-closed wie #1079; Low-Risk-Adapter für jq/grep sind separater Follow-up | Generic auf low senken (öffnet unshaped Kommandos) |
| 2026-07-29 | Substitution in irgendeinem Segment → opaker Pfad | Konsistenz mit YOLO-Evaluator; Substitution kann nested Kommandos verstecken | Substitution-Segmente generic auflösen (täuscht Struktur vor) |
| 2026-07-29 | Dual-Track: Shapes = Scoping-Primärweg, Wildcards = Shape-less-Fallback | Patricks Entscheid; Globs können Konto-/Resource-Scoping nicht brittle-frei (Flag-Reihenfolge), Shapes kann kein beliebiges LLM-Shell | Shapes verwerfen (verliert Risk-Threshold + Capability-Grants); Patterns verwerfen (LLM-Shell bräuchte lückenlose Adapter) |
| 2026-07-29 | Registry beschneiden: nur CLIs mit Risiko-Gefälle | coreutils-Adapter kaufen nichts vs. Generic+Patterns, sind aber Pflege- und Supply-Chain-Fläche (auto-install ab GitHub raw) | Registry weiter ausbauen (Kosten ohne Nutzen) |

## Session-Checkliste

1. Worktree auf origin/main? (`git fetch && git status`)
2. Diesen Plan lesen, Progress-Section prüfen
3. Baseline: betroffene Test-Filter grün VOR Änderungen
4. Nach jedem Milestone: Progress + Discoveries aktualisieren, Commit
5. Gates: lint → typecheck → Tests (Kosten-Reihenfolge)
