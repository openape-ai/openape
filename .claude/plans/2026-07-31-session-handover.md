# Session-Handover 2026-07-31 — Grant-UX komplett, Forgejo 15.0.5, chatty sauber

> Self-contained: von oben nach unten lesbar, ohne Vorwissen ausführbar.
> Vorgänger: `.claude/plans/2026-07-30-session-handover.md` und
> `.claude/plans/2026-07-30-recurring-grants-ux.md` (Plan komplett umgesetzt).

## Zustand: alles grün, nichts brennt

Die Session 30.07.–31.07. hat den kompletten Grant-UX-Plan geliefert und den
Betrieb aufgeräumt. **Grant-Inbox steht auf 0** (Ziel war ~0–2/Tag, vorher ~25).
Prod-Stände: free-idp `prod-82c78289`, troop `prod-115a65bc`. npm: apes 1.35.0,
nuxt-auth-idp 0.35.0. Forgejo auf **15.0.5** (war 15.0.2). chatty-Systemplatte
56 % (war 87 %), Registry auf `/data` (98-GB-Platte) verlagert.

### Was live ist (Kette der PRs #1111–#1125)

| Feature | PR | Wo |
|---|---|---|
| Drift-Anzeige Rollen-tools ↔ YOLO-Policy im Cockpit (Firma-Tab) | #1111, Scope-Fix #1117 | troop |
| 48h-TTL für pending Grant-Anfragen (lazy expiry) | #1112 | nuxt-auth-idp 0.35.0 |
| ape-shell erklärt pending (Diagnose + „NEVER auto-approved") | #1113 | apes 1.35.0 |
| `fj`-Wrapper (issues/issue/prs/pr/ci --wait/comment/assign, ALLE auto-approved) | #1115 | worker |
| Directive: SHELL-STIL (keine `$( )`/Loops/Heredocs) + CODE-ARBEIT | #1115 | worker |
| `code-task` Worktree-Runner (Code-Arbeit gated am PR statt pro Kommando) | #1120 | worker |
| code-task Detach-Fix (setsid via Popen), Issue-State-Guard, /tmp-Cleanup | #1125* | worker |
| Preview-Teardown räumt stillgelegte Apps ab (`RETIRED_UUIDS`) | #1124 | scripts |
| Audit-Overrides @hono/node-server + tar; **Gate grün, `--no-verify` UNNÖTIG** | #1123 | root |

*#1125 = fix/code-task-detach; Nummer ggf. per `fj prs`/git log prüfen.

### Worker am Mini (launchd `at.openape.worker`)

Installiert == serviert (drift-Check grün, Stand `prod-115a65bc`). Wrapper
`fj` + `code-task` liegen in `~/.config/openape-worker/` mit Symlinks in
`~/.local/bin`. `ensure_wrappers` in worker.sh zieht fehlende Wrapper selbst
nach. apes-CLI global via **pnpm** (nicht npm!) auf 1.35.0.

## Prioritäten für die nächste Session

1. **#1038 — Scope-Prüfung deckt 10 von 103 troop-Endpoints ab.** Einziges
   offenes Thema mit Sicherheitsgewicht. Kontext: der Scope-Catalog
   (`apps/openape-troop/server/utils/scope-catalog.ts`) prüft delegierte
   Tokens routengenau — gestern fehlte die neue yolo-sync-Route (403, #1117).
   #1038 ist die Gegenrichtung: die meisten Endpoints prüfen gar nicht.
   Empfehlung: erst Inventar (welche Endpoints, welche Auth), dann Catalog
   systematisch füllen; Tests in `apps/openape-troop/tests/scope-catalog.test.ts`.
2. **Beobachtung code-task:** erster DURCHGEHENDER autonomer Erfolg (Operator
   startet → codex implementiert → PR) steht aus. #1118 endete korrekt mit
   „nichts zu tun". Guter Kandidat zum Zusehen: #1052 (klein, klar). Der
   Operator hat die Anleitung in der Directive (deferred + `code-task status`).
3. **Beobachtung Phantom-Merge:** seit Forgejo 15.0.5 alle Merges sauber
   (Stichprobe ~4). Regeln bleiben: Merges ≥30 s auseinander, main-Tip nach
   jedem Merge verifizieren, Branch erst danach löschen. Tracking: #1122.
4. **Kleinere Kanten** (je ~1 Session, unpriorisiert): `agents/[id].vue`
   löscht ohne Rückfrage · `GET /api/standing-grants` liefert `[]` obwohl
   Records existieren (tote Lese-Oberfläche, Records liegen im Grant-Store) ·
   gmail-cli schluckt unbekannte Argumente still (`calendar list tomorrow`) ·
   DE/EN-Mischung im IdP · `/docs`-Redesign · Low-Risk-Adapter grep/head/tail/cut.

## Offene Owner-Entscheidungen (nichts blockiert)

- Coolify: stillgelegte `org`-Application (Status exited, inert) ganz löschen?
- https://troop-docs.preview.openape.ai (läuft bewusst seit 09.06. im
  previews-Projekt) behalten → dann in reguläres Coolify-Projekt verschieben?
- Registry-GC für alte `prod-<sha>`-Tags (troop allein 3,7 GB von 7,6 GB) —
  unkritisch, /data hat 82 GB frei; `_TAG_PREV`-Stände müssen überleben.
- Forgejo 16.0.1: nur falls Phantom-Merge wiederkommt oder als geplanter
  Schritt; Prozedur wie beim 15.0.5-Upgrade (unten).

## Betriebszustand

- **Standing Grants bis 2026-09-06 23:59** (alle max_risk low): Delta Mind
  o365 `d47131c0` + jq `809b53a1` · IURIO o365 `833d899f` + jq `b936b426` ·
  privat gmail `628fe8db` + jq `c43bc209`. Verlängern = Nachfolger via
  `POST /api/standing-grants` anlegen + alte revoken (kein Update-Endpoint).
- **YOLO-Policies**: synced, Drift-Anzeige im Cockpit-Firma-Tab zeigt Zustand
  („Operator-Policy aktuell (allow-list, N Muster) · bestätigt vor X").
- **Backups auf chatty**: `/var/backups/forgejo-2026-07-30/` — Forgejo-15.0.2-
  Binary, app.ini, DB-Snapshot, Registry-config.bak, Coolify-Preview-Rows-CSV.

## Infrastruktur-Fakten (neu diese Session)

- **chatty-Zugang**: `ssh ubuntu@chatty.delta-mind.at`, `sudo -n` passwortlos.
  Zwei Platten: `/` 48 G (56 %), `/data` 98 G (17 %). Docker auf `/data/docker`.
- **Registry**: systemd `openape-registry.service`, Daten `/data/registry/data`.
  Bei Pfadänderungen DREI Stellen: config.yml + Daten + `ReadWritePaths`-Drop-in
  (`ProtectSystem=full`!).
- **Forgejo**: systemd `forgejo.service`, User git, `/var/lib/forgejo`,
  Binary `/usr/local/bin/forgejo`. Upgrade-Prozedur: Binary laden + sha256,
  Backup (Binary/app.ini/`sqlite3 .backup`), stop, install, start, Journal auf
  Migrationen prüfen, Smoke (Wegwerf-Repo: Push → Actions → Merge → Tip bewegt).
- **Coolify** läuft auf chatty (Container coolify/-db/-proxy/…); DB-Zugriff:
  `sudo docker exec coolify-db psql -U coolify -d coolify`.
  Preview-Records: Tabelle `application_previews`.

## Teuer gelernte Fallen dieser Session

1. **Forgejo-Phantom-Merge**: merged=True + HTTP 200 beweisen NICHTS — nur der
   main-Tip. Reflog-Signatur: Merge landet, 0–1 s später setzt dieselbe Op main
   per `update by push` auf ihren Start-Stand zurück. Trigger: Merge startet
   Sekunden nach vorheriger main-Bewegung (3-s-Merge-Schleifen!). NICHT auf
   kleinem Repo reproduzierbar — braucht Last des echten Repos. Memory:
   `forgejo-merge-worktree-corrupt`.
2. **nohup reicht nicht zum Detachen**: der Worker reißt die Prozessgruppe des
   Operator-Tasks mit. Echte neue Session nötig — macOS hat kein setsid-Binary,
   Weg: `python3 Popen(start_new_session=True)`. Und: ein E2E aus der
   interaktiven Shell testet den Tod des echten Aufrufers NICHT mit.
3. **Neue Agent-Route → Scope-Catalog**: requireCockpitAgent allein genügt
   nicht; delegierte Tokens werden routengenau gegen den Catalog geprüft
   (403 sonst). Fire-and-forget-Pfade bei der Abnahme einmal MIT sichtbarem
   Output fahren — der Worker-Report hatte den 403 geschluckt.
4. **Forgejo schließt Issues nur bei englischen Keywords** (closes/fixes/
   resolves) — „Schließt #1118" tat nichts, der Dev-Loop grindete am toten
   Issue weiter.
5. **codex-Sandbox (workspace-write) schützt `.git`** — `git commit` im Agent
   scheitert mit Operation not permitted. Muster: Agent schreibt COMMIT_MSG.txt,
   der Runner committet.
6. **pnpm-Override-Selector `pkg@<range>`** matcht gegen deklarierte Specs,
   nicht resolved Versionen — `vite@8` griff nicht. Erst empirisch prüfen
   (`pnpm why`), bevor man einem Override traut.
7. **`===` als echo-Argument** killt zsh-Kommandos (`== not found`) — in
   Heredocs/Skripten `"==="` quoten oder printf.
8. **apes global via pnpm** (`~/Library/pnpm`), nicht npm — `npm i -g` wäre
   das bekannte .hermes-Phantom-Update.

## Arbeitsumgebung

- **Worktree**: `~/Companies/private/repos/openape/openape-monorepo.worktrees/idp-design-system`
  (auf main). NICHT im Primary-Checkout arbeiten (multi-agent shared).
- **Push**: normal, OHNE `--no-verify` — der volle pre-push-Gate ist grün
  (~40 s mit warmen Caches). Die alte Memory dazu ist gelöscht.
- **PR/Merge via Forgejo-API** (`~/.netrc`-PAT). Merge-Muster: `{"Do":"merge"}`,
  danach main-Tip pollen bis der Merge drin ist, ERST DANN Branch löschen.
  Mehrere Merges ≥30 s auseinander.
- **Release**: `pnpm changeset version` auf Branch → PR → merge → `pnpm
  release:dry` → `pnpm release` → `pnpm run deploy:image <targets>`.
- **Worker-Update am Mini**: Dateien von https://troop.openape.ai/worker/
  diffen (Nur-installiert-Zeilen prüfen!), kopieren, `launchctl kickstart -k
  gui/501/at.openape.worker` in einer Task-Lücke; Log muss `[drift]
  installierte Dateien == serviert` zeigen.
- **Verifikations-Harness**: `~/.openape/dev-harness/` (Wegwerf-IdP, Cookie-
  Minting inkl. SP-Cookies via `COOKIE_NAME=openape-sp`, CDP-Screenshots).
  Prod-troop-Screenshots: Session-Secret aus chatty-.env minten, Cookie-Datei
  danach LÖSCHEN.

## Checkliste Session-Start

1. `git -C <worktree> fetch && git status` — auf origin/main?
2. `apes grants inbox --json` — Inbox sollte ~0 sein; mehr = Regression.
3. `tail ~/.config/openape-worker/worker.log` — Ticks laufen? drift grün?
4. `fj prs` / `fj issues` — was hat der Dev-Loop über Nacht getan? Insbesondere:
   gibt es einen autonomen code-task-PR (Priorität 2)?
5. Bei Merges: main-Tip-Verifikation nicht vergessen (Falle 1).
