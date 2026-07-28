# Goal

Heute existieren **6 separate Repos** (`openape-pr`, `openape-testrun`, `openape-timetrack`,
`openape-tasks`, `openape-plans`, `openape-preview`), die alle dieselbe „Artefakt hochladen →
oeffentlicher `/r/<slug>`-Beweislink → Verdict pollen"-App sind, 6x geforkt. Jede hat eine
eigene CLI (`ape-tasks`, `ape-testruns`, ...). Die CLIs teilen ~8 Dateien, die sich **nur durch
den App-Namen unterscheiden** — reiner Drift, keine echte Logik-Differenz.

**Nach diesem Plan** gibt es ein npm-Paket `@openape/proof-cli`, das den geteilten CLI-Kern
liefert. Eine App-CLI schrumpft von ~1000 auf ~80 Zeilen: import + ein App-Descriptor + ihre
*eine* domaenenspezifische Commands-Datei. `openape-tasks` ist der erste Konsument; sein
`ape-tasks`-Output bleibt byte-identisch.

Dies ist **Phase 1** der CLI-Konsolidierung. Phase 0 (Regel: kein Repo #7, neue proof-link-Tools
als `apps/x` im Monorepo) ist gratis und laeuft parallel. Phase 2 (die anderen 5 Repos migrieren)
passiert **opportunistisch** — nur wenn ein Repo ohnehin angefasst wird, nie als Sondertermin.

## Warum das verdient ist (Diff-Beweis)

Stichprobe `diff openape-tasks/cli/src/commands/logout.ts openape-testrun/.../logout.ts`:
*jede* geaenderte Zeile ist nur `tasks` -> `testrun` (Endpoint, Config-Dateiname, Beschreibung).
`client.ts` genauso: der ganze Diff ist `tasksClient`/`tasks.openape.ai`/`APE_TASKS_ENDPOINT`/
`auth-tasks.json` vs. die testrun-Strings. Einzige strukturelle Abweichung: `tasks` hat
`TasksState extends SpClientState { activeTeamId }` (weil tasks Teams hat), die anderen nehmen
nacktes `SpClientState`.

Die Divergenz ist exakt durch 5 Strings parametrisiert, die `createSpClient<State>()` aus
`@openape/cli-auth` **heute schon** als Config nimmt:
`{ defaultEndpoint, envVar, configFile, defaultAud }`.

## Was NICHT ins Paket kommt

- **`api.ts`** bleibt pro-App (echte Endpoint-Unterschiede, keine reine Substitution).
- **Die eine Domain-Commands-Datei** (`tasks.ts`/`prs.ts`/`runs.ts`) + `docs/*.md` bleiben pro-App.
- **`openape-preview`** ist der Ausreisser (api.ts 108 statt 45 Zeilen, kein `client.ts`) — migriert
  zuletzt oder gar nicht. Nicht Teil dieses Plans.

## Prerequisites

- [ ] `apes login` aktiv auf dem Geraet (DDISA), `pnpm` >= 9.
- [ ] Klaeren: ist `@openape/proof-cli` ein **Monorepo-Paket** (`openape-monorepo/packages/proof-cli`)
      oder ein **Standalone-Repo**? Die 6 Apps sind eigene Forgejo-Repos und konsumieren `@openape/cli-auth`
      heute als **npm-Dep**. -> Paket muss **npm-published** sein, damit die Standalone-Repos es ziehen
      koennen. Empfehlung: in `openape-monorepo/packages/proof-cli`, publish via bestehende
      `scripts/publish-chain.mjs` (PACKAGES-Liste ergaenzen -> siehe reference_npm_publish_flow).

## Decision Log

| Entscheidung | Wahl | Begruendung / verworfen |
|---|---|---|
| Paket-Ort | `openape-monorepo/packages/proof-cli` | Publish-Chain existiert dort; cli-auth liegt auch dort |
| Donor-App | `openape-tasks` | Reichster CLI-Stand (1055 Z., hat Teams = haertester Testfall) |
| API-Surface | `defineProofCli(descriptor)` | Ein Objekt = der ganze App-Unterschied; minimal |
| api.ts teilen? | Nein | Echte Endpoint-Differenz, keine Substitution |
| preview migrieren? | Nicht in diesem Plan | Ausreisser, schlechtester ROI |

## Milestones

### M1 — Paketgeruest `@openape/proof-cli`
**Goal:** Ein build-bares, leeres Paket im Monorepo.
**Steps:**
1. `openape-monorepo/packages/proof-cli/` anlegen: `package.json` (name `@openape/proof-cli`,
   dep `@openape/cli-auth`), `tsconfig.json`, `tsup`-Config analog zu `packages/cli-auth`.
2. `src/index.ts` exportiert vorerst nur einen Typ `ProofCliDescriptor`.
**Proof:** `pnpm --filter @openape/proof-cli build` exit 0; `dist/index.mjs` existiert.

### M2 — Geteilten Kern aus `openape-tasks` hochziehen
**Goal:** Die 8 generischen Dateien leben im Paket, parametrisiert.
**Steps:**
1. `defineProofCli(descriptor)` baut die Commander-Instanz (war `cli.ts`), verdrahtet die
   Standard-Commands `login/logout/whoami/open/docs` (aus `openape-tasks/cli/src/commands/*`),
   `output.ts`, `docs.ts`, und instanziiert `createSpClient<State>()` aus dem Descriptor.
2. Descriptor-Felder: `{ name, endpoint, envVar, aud, configFile, domainCommands, docsDir, stateExtra? }`.
   `stateExtra` deckt den `TasksState.activeTeamId`-Fall generisch ab (Default: `SpClientState`).
3. App-Name-Strings (`'tasks SP-token'`, `auth-tasks.json`, ...) durch `descriptor.name`-Interpolation
   ersetzen — 1:1 die Stellen aus dem logout/client-Diff.
**Proof:** `pnpm --filter @openape/proof-cli build` gruen; Unit-Smoke: `defineProofCli({name:'x',...})`
liefert ein Commander-Objekt mit den 5 Standard-Commands (assert in `test/smoke.mjs`).

### M3 — `openape-tasks` auf das Paket umstellen
**Goal:** `ape-tasks` laeuft ueber `@openape/proof-cli`, Output unveraendert.
**Steps:**
1. In `openape-tasks/cli/`: dep `@openape/proof-cli` (workspace/npm), die 8 generischen Dateien
   loeschen, `cli.ts` reduzieren auf `defineProofCli({ name:'tasks', endpoint:'https://tasks.openape.ai',
   envVar:'APE_TASKS_ENDPOINT', aud:'tasks.openape.ai', configFile:'auth-tasks.json',
   domainCommands:[tasksCmd, teamsCmd, acceptCmd], docsDir:'./docs', stateExtra:{activeTeamId} })`.
2. `api.ts` + Domain-Commands bleiben unveraendert.
**Proof (byte-identisch — das ist das Akzeptanzkriterium):**
```
node openape-tasks/cli/dist/cli.mjs --help                 > /tmp/before-help.txt
node openape-tasks/cli/dist/cli.mjs docs cli               > /tmp/before-docs.txt
pnpm --filter @openape-tasks/cli build
node openape-tasks/cli/dist/cli.mjs --help                 > /tmp/after-help.txt
node openape-tasks/cli/dist/cli.mjs docs cli               > /tmp/after-docs.txt
diff /tmp/before-help.txt /tmp/after-help.txt              # leer = pass
diff /tmp/before-docs.txt /tmp/after-docs.txt              # leer = pass
ape-tasks list --json | head                               # exit 0, echte Daten
```

### M4 — Publish + lokal verifizieren
**Goal:** Paket auf npm, tasks-CLI zieht die published Version.
**Steps:**
1. `@openape/proof-cli` in `scripts/publish-chain.mjs` PACKAGES eintragen (vor den Konsumenten).
2. `pnpm release` (lokal, kein CI-Release — reference_npm_publish_flow).
**Proof:** `npm view @openape/proof-cli version` zeigt die neue Version; frischer
`npm i -g @openape/ape-tasks@latest` + `ape-tasks whoami` exit 0.

## Risks

- **Byte-Diff schlaegt fehl wegen Hilfetext-Reihenfolge** (Commander sortiert Commands evtl. anders,
  wenn aus dem Paket registriert). Mitigation: Reihenfolge im Descriptor explizit kontrollieren;
  zur Not `--help`-Diff lockern, `docs`-Diff bleibt hart.
- **`stateExtra`-Generik wird zu clever.** Mitigation: wenn nur tasks es braucht, simpler
  Durchreicher statt Typ-Akrobatik. ponytail: kein Generics-Turm fuer 1 Feld.
- **6-Repo-Drift war doch nicht rein kosmetisch in einem ungeprueften File.** Mitigation: Phase 2 ist
  pro Repo separat verifizierbar (byte-Diff je App); ein nicht-passendes File blockt nur dieses Repo.

## E2E-Verifikation (Gesamtbeweis)

```
pnpm --filter @openape/proof-cli build                     # exit 0
pnpm --filter @openape-tasks/cli build                     # exit 0
diff /tmp/before-docs.txt /tmp/after-docs.txt              # leer
wc -l openape-tasks/cli/src/cli.ts                         # ~80 statt ~1055
ape-tasks list --json                                      # exit 0, prod-Daten unveraendert
```

## Progress

- [x] Diff-Probe: Drift bestaetigt (logout/client = reine App-Namen-Substitution) — 2026-06-26
- [ ] M1 — Paketgeruest
- [ ] M2 — Kern hochziehen
- [ ] M3 — tasks umstellen (byte-Diff pass)
- [ ] M4 — publish + verifizieren
- [ ] Phase 2 (separat, opportunistisch): pr / testrun / timetrack / plans
- [ ] Phase 3 (evtl. nie): Nuxt-Layer fuers server/-Skelett

## Decision (2026-06-26, Patrick)

- **Paket-Ort: Monorepo** (`openape-monorepo/packages/proof-cli`). Prereq damit geklaert.
  Publish via bestehende `scripts/publish-chain.mjs` (PACKAGES-Liste ergaenzen). Kein neues Repo.
