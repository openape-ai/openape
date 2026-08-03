# Offene Baustellen — troop / company-loop / IURIO (Stand 2026-07-13)

> Übergreifender Überblick über alle offenen Fäden aus der langen Session um den
> cockpit-procedures-Plan. Der Plan selbst (`2026-07-10-cockpit-procedures.md`) ist
> M0–M4 KOMPLETT; hier stehen die Dinge, die darüber hinaus offen sind, damit nichts
> aus dem Blick gerät. Erledigte Milestones sind unten kurz als Kontext gelistet.

## A. „Firma echt machen" (Plan B, schrittweise)
- [x] `[2026-07-13]` **Checker-Rollen mit eigenen Prozeduren** — Code Reviewer / Tester / Visual Reviewer
      tragen je eine `procedure` + `vars:{boardUser:254}` in troop (prod). Handoff = **Board-Lane-getrieben**:
      Programmierer legt den PR in die Review-Lane; die Checker ziehen daraus, prüfen, posten ein
      `[Code/Test/Visual Review] VERDICT: …`-Board-Kommentar — beratend, **nie mergen/voten/Code anfassen**.
      Muster verifiziert: Code Reviewer lief gegen PR #744 → APPROVED mit echten Findings (JSDoc `@returns`
      ArrayBuffer vs Uint8Array), Board-Kommentar 1607, Karte unbewegt, kein Vote/Merge. Tester +
      Visual Reviewer nach demselben Schnitt gebaut (noch nicht separat gesmoked — gleiche Struktur).
- [x] `[2026-07-13]` **Programmierer entschlackt:** trägt oben „You are the MAKER — you do NOT review your
      own work" + Verweis auf die 3 Checker-Rollen; das UI-Self-Gate (dispatch visual-qa + „proceed only on
      APPROVED") ist raus — er rendert nur noch die Screenshots als objektiven Beweis, die unabhängige
      Visual-Reviewer-Rolle prüft nach dem PR.
- [x] `[2026-07-13]` **Voller Dienstweg-Smoke** — alle drei Checker reviewten PR #744 gemeinsam,
      unabhängig auf dem Board verifiziert: Code Review **APPROVED** (#1607), Test Review **ADEQUATE**
      (#1609 — Tester verifizierte „rot ohne Fix" real im Wegwerf-Worktree: ohne Fix TypeError 13/14,
      mit Fix 14/14, danach entfernt), Visual Review **N/A** (#1608 — pure-JS, kein Rendern). Karte
      unbewegt (Review), PR active, alle Votes 0 — kein Merge/Vote. CEO-Konsolidierung als Owner-Report
      in troop gepostet. **Maker/Checker-Kette auf Org-Ebene end-to-end bewiesen.**

## B. Firma vervollständigen (Plan B)
- [x] `[2026-07-13]` **CEO + Scrum Manager Prozeduren** in troop (prod). Scrum Manager: Board-Lage
      erfassen → Reports walken → Team-Status hoch. CEO: direkte Reports walken → Owner-Report
      (Ziele/PRs/Blocker/„was der Owner tun muss") via `company.sh report`. `troop-company-loop/SKILL.md`
      angepasst: die Session-als-CEO liest+folgt der CEO-**Prozedur aus dem Tree** (portabel); SKILL.md
      = nur noch Loop-Mechanik + Inline-Fallback. **Jede aktiv arbeitende Rolle hat jetzt eine Prozedur.**
- [x] `[2026-07-13]` **Mail & Kalender-Assistent:** bleibt bewusst **read-and-report** (klare Ein-Satz-Duty
      + scoped tools o365-cli*/pdftotext*); eine Prozedur kann später kommen, wenn er mehr als melden soll.
- [ ] **Voller Firmen-Lauf smoke** (offen): `/loop /troop-company-loop org=<iurio>` in eigener Session —
      testet die CEO+Scrum-Orchestrierung end-to-end (verschachtelte Subagents). Bisher gesmoked: die
      Checker einzeln + kollektiv; die Manager-Ebene (CEO liest seine Prozedur, spawnt Scrum, der spawnt
      die 4) noch nicht als ein Lauf. Gehört in eine dedizierte Loop-Session.

## B2. Delta-Mind-Company + OpenApe-Dev-Team (2026-07-13)
- [x] **OpenApe als eigenes Projekt-Team unter Delta Mind** in troop (prod). Zweiter teamlead
      „OpenApe Scrum Manager" neben dem generischen Projektmanager, Crew darunter (Programmierer/
      Code Reviewer/Tester/Visual Reviewer) — Forgejo-adaptierte Prozeduren (Issue-State statt Lanes,
      PR-Kommentar-Verdicts, `pnpm turbo` statt cypress, Forgejo-REST-PR statt az). Org-IDs +
      Board-Modell im Memory `deltamind-openape-team`.
- [x] **Zwei-Ebenen-Board:** troop `objectives` = CEO-Ziel-Ebene; **Forgejo-Issues (Label `agent`)**
      = Crew-Board (troops objectives ist zu dünn: 4 Status, kein Assignment/Kommentar/Attachment).
      tooling-Block auf `org.vars.tooling` (Merge kaskadiert nicht → org-Ebene; für Nicht-Dev-Rollen
      inerte Daten). Swappable Team-Binding bewiesen (Crew erbt `boardKind=forgejo-issues`).
- [x] `[2026-07-13]` **Delta-Mind-CEO-Prozedur** (proc 2392c, injectionScore 0): liest `objectives`,
      walkt alle 5 direkten Reports synchron (OpenApe Scrum Manager fährt den Dev-Zyklus, Rest
      read-and-report), verdichtet einen Owner-Report (Fortschritt/PRs/Blocker/„was der Owner tun muss")
      via `company.sh report`. Guardrails: nichts nach außen (kein Merge/Send/Publish).
- [x] `[2026-07-13]` **Tooling-Verb-Smoke (deterministisch, aufgeräumt):** Forgejo-Schreibverben bewiesen
      — Issue #938 angelegt → kommentiert → Label `question` → geschlossen. git-Write-Auth = dasselbe
      `.netrc` wie der bewiesene Read (`ls-remote`); Push läuft durchs lokale `.githooks/pre-push`-CI-Gate
      (build+audit+lint+typecheck+test — schwer, by-design; die §5-Checks des Programmierers erfüllen es).
- [x] `[2026-07-13]` **Agent-Smoke (Code Reviewer als Subagent):** löste `vars.tooling.board` real auf,
      traf Forgejo (HTTP 200, 0 PRs), stoppte korrekt bei „nichts zu reviewen", alle Guardrails gehalten.
      Verdrahtung aus einem dispatchten Knoten heraus bewiesen.
- [ ] **Voller Ship-a-PR-Lauf** (offen, owner-getriggert): das letzte ungeprüfte Verb ist der echte
      Programmierer-Durchlauf (offenes `agent`-Issue → push forgejo → PR create). Bewusst nicht als
      Junk-PR ins Prod-Repo fabriziert — wird beim ersten echten `agent`-Issue mitbewiesen.
- [ ] **Voller Delta-Mind-Company-Lauf** (offen): `/loop /troop-company-loop org=<deltamind>` in eigener
      Session — CEO walkt alle 5 Reports (inkl. Live-o365-Assistenten). Gehört in eine dedizierte
      Loop-Session (Nesting: die Session IST der CEO; Manager-Subagents können nicht weiter nesten).

## C. troop/Code — funktionale Lücken (Task-Chips)
- [~] **`injectionScore` durch den Tree-Endpoint reichen** (Chip task_cebdd353) — **PR #939 offen**
      (git.openape.ai/openape-ai/openape/pulls/939, Branch `bugfix/troop-tree-injection-score`).
      tree.ts + tree.get.ts reichen `injectionScore`/`injectionReason` jetzt durch, Test in
      cockpit-tree.test.ts. Lokal lint+typecheck+test grün (troop). **Offen:** CI grün → Patrick mergt →
      `pnpm run deploy:image troop` (erst nach Redeploy ist der Guard in prod scharf).
- [ ] **Heuristik-False-Positive `sensitive-path`:** die Programmierer-Prozedur scort 0.45, weil sie
      `.env`/`~/.config` erwähnt — um sie zu VERBIETEN. Kontext-blind. Evtl. Heuristik verfeinern
      (Verbots-Kontext erkennen) oder als bekannte Grenze akzeptieren (LLM-Backend ist der spätere Job).

## D. CI-Qualität (Task-Chips)
- [ ] **yolo-policy E2E Seeding-Race stabilisieren** (Chip task_55ddb53e). `POST /api/admin/users`
      gibt direkt nach nuxt-dev-Boot manchmal 403 (Server-Readiness-Race). Jetzt im nicht-blockierenden
      e2e-Job isoliert, aber zu härten (auf Admin-API-Readiness warten, nicht nur well-known).
- [ ] **pre-commit Lockfile-False-Positive:** bei Script-only-`package.json`-Änderungen meldet der Hook
      „lockfile needs updating", obwohl `pnpm install --lockfile-only` identisch ist (tmpdir-Vergleich
      ohne node_modules). Hook robuster machen.

## E. Loop-Engineering-Rückstände (aus dem Abgleich mit addyosmani.com/blog/loop-engineering)
- [ ] **Token-Budget als Loop-Gate.** troop hat `cost_snapshots`/Budget-Felder, aber der Loop nutzt
      sie nicht als Grenze. Osmani: Sub-agent-Proliferation verbrennt Tokens → bewusstes Budget.
- [ ] **Formales `/goal`-Stop-Condition-Gate mit frischem Verifikations-Modell.** Wir haben Loop-until
      + troop-`objectives`, aber der Loop verifiziert Ziel-Erreichung nicht mit einem separaten frischen
      Modell (Maker/Checker auf Completion-Ebene).

## F. Offene Fäden / Housekeeping
- [ ] **PR #744 (IURIO, `bugfix/hex-empty-guard`)** wartet auf Patricks Review + Merge (M3-Beweis-PR,
      nicht gemergt).
- [ ] **Plan-Doc-Änderungen** (M2/M3/M4-Notizen in `2026-07-10-cockpit-procedures.md`) liegen uncommitted
      im Working Tree. main ist PR-only → per PR landen ODER bewusst lokal lassen. Auch DIESE Datei.
- [ ] **TOBI_CODING_STYLE.md** nicht auffindbar (Dateisystem-weit, iurioServer-Git-Tree: 0 Treffer).
      Wiki-Suche (`iurioServer.wiki` auf Azure DevOps) wurde unterbrochen → zu Ende führen oder Pfad
      von Patrick. Falls gefunden: gegen die Code-Qualitätskriterien im Standalone-Prompt §6 abgleichen.
- [ ] **iurio-loop-Orchestrator** (`SKILL.md`) liest seit M4 die Prozedur aus troop, wurde aber noch
      NICHT end-to-end via den Orchestrator gelaufen (M3 war Direkt-Dispatch des Programmierer-Knotens).
      Optionaler Smoke, wenn ein passender Sprint-Task da ist.

## Erledigt (Kontext, nicht mehr offen)
- M1 (Schema/Tree/UI, PR #931) + M2 (Injection-Profiler, PR #937) auf main + prod (troop prod-747aed95).
- CI-Härtung: tsup-dts-Race-Fix (vollständig), shell-login-Fix, free-idp-E2E-Isolation — alle auf main.
- M3: Loop liest Prozedur aus troop → echter az-PR #744, unabhängig verifiziert (Push, PR, Board).
- M4: run-one-task.md archiviert (mit Erklärung), iurio-loop liest aus troop, .iurio-loop.env entschlackt.
- Standalone-Prompt (`~/.claude/skills/iurio-loop/standalone-prompt.md`) für autarke Sessions.
- az-headless-PR-Pfad (`AZURE_DEVOPS_EXT_PAT=""`) end-to-end bewiesen.
