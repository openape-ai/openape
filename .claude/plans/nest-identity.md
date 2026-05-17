# Plan: Nest WS-Auth via existing DDISA-Agent-Identity

> Self-contained plan: ein Agent ohne Vorwissen kann diesen Plan top-down
> abarbeiten und kommt zu einem funktionierenden Ergebnis.

## Purpose / Big Picture

- **Ziel:** Der `@openape/nest`-Daemon verbindet sich erfolgreich zur troop-WS
  (`● live`-Badge in troop-UI sichtbar), config-update propagiert in <2s,
  "+ Spawn agent" aus troop funktioniert end-to-end.
- **Kontext:** PR #405 hat client+server gebaut, aber der WS-server enforced
  `act: human`. Der Nest hat schon eine eigene DDISA-Agent-Identity (via
  `apes nest enroll`), die mit `act: agent` signiert. Server-Auth muss also
  lockern statt nest-bootstrap neu zu bauen.
- **Discovery beim Plan:** Während des Plans hab ich entdeckt, dass das
  ganze nest-identity-Setup bereits existiert (`apes nest enroll`,
  `apes nest install` mit User-LaunchAgent + HOME=~/.openape/nest, mit
  auth.json die einen `act:agent` JWT enthält). Mein vorheriger Fehler:
  ich hatte den User-LaunchAgent entfernt zugunsten eines legacy
  System-LaunchDaemon (HOME=/var/openape/nest, KEINE identity). Cleanup
  + Server-Auth-Lockerung sind die einzigen echten Schritte.

## Repo-Orientierung

- **Projekt:** OpenApe monorepo
- **Relevante Dateien:**
  - `apps/openape-troop/server/routes/api/nest-ws.ts` — derzeit `act: human` enforcement (ZIEL der Änderung)
  - `apps/openape-troop/server/utils/auth.ts` — `requireAgent`-Pattern (Vorbild)
  - `apps/openape-troop/server/utils/agent-email.ts` — `parseAgentEmail` (extrahiert owner-domain aus agent-email)
  - `apps/openape-nest/src/lib/troop-ws.ts` — Client-side (verwendet schon `ensureFreshIdpAuth()` — kommt mit act:agent token zurück wenn HOME richtig)
  - `apps/openape-troop/server/utils/nest-registry.ts` — in-memory peer registry (genügt — keine DB-Tabelle nötig)
- **Existing tooling:**
  - `apes nest install` — schreibt User-LaunchAgent plist, HOME=~/.openape/nest
  - `apes nest enroll` — registriert nest als DDISA-Agent im IdP, schreibt auth.json
- **Tech-Stack:** Node.js 22, h3, jose, crossws
- **Dev-Setup:**
  - lint+typecheck: `pnpm turbo run lint typecheck --filter=@openape/troop`
  - dev: `cd apps/openape-troop && pnpm dev`

## Hintergrund: Aktueller State und Identity-Architektur

**Identity ist schon da:**
```
~/.openape/nest/
├── .ssh/
│   ├── id_ed25519           (private key, 0600)
│   └── id_ed25519.pub       (ssh-ed25519 …)
└── .config/apes/
    └── auth.json            { access_token (act:agent), email: nest-…@id.openape.ai, … }
```

**Mini state heute** (nach versehentlichem cleanup vorhin):
- System-LaunchDaemon `/Library/LaunchDaemons/ai.openape.nest.plist` — UserName=`_openape_nest`, HOME=`/var/openape/nest` (KEINE identity dort) — soll WEG
- User-LaunchAgent `~/Library/LaunchAgents/ai.openape.nest.plist` — soll wiederhergestellt werden via `apes nest install`

## Milestones

### Milestone 1: troop WS akzeptiert act:agent

**Ziel:** Server-side WS-handshake erfolgt mit `act:agent` JWT; ownerEmail
wird aus `parseAgentEmail(claims.sub).ownerLocalpart + '@' + ownerDomain`
abgeleitet. Bestehender `act:human`-Pfad bleibt für künftige UI-Direct-Connect.

**Schritte:**
1. `apps/openape-troop/server/routes/api/nest-ws.ts`:
   - JWKS-verify bleibt
   - Statt `if (claims.act !== 'human') reject`: 
     - `act:human` → `ownerEmail = claims.sub` (wie bisher)
     - `act:agent` → `parsed = parseAgentEmail(claims.sub)`; `ownerEmail = parsed.ownerLocalpart + '@' + parsed.ownerDomain.replaceAll('_','.')` (reverse von domain-encoding)
     - sonst reject
   - **Achtung:** `parseAgentEmail` encodet domain mit `_` statt `.` (`hofmann_eco` → `hofmann.eco`). Hilfsfunktion in agent-email.ts checken — bei Bedarf Helper `ownerEmailFromAgentEmail` extrahieren.
2. **Skip:** Keine separate `nests` DB-Tabelle. In-memory peer registry deckt alles ab. `/api/nest/hosts.get.ts` listet schon aus dem in-memory registry.

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run lint typecheck test --filter=@openape/troop` grün
- [ ] Vitest-test: act:agent JWT für `nest-…+patrick+hofmann_eco@id.openape.ai` resolved zu `patrick@hofmann.eco` und WS-handshake akzeptiert
- [ ] Vitest-test: act:agent JWT mit nicht-derivable owner-format → reject

**Rollback:** Code-revert; legacy 5min-poll bleibt unbehelligt.

### Milestone 2: Mini cleanup — System-LaunchDaemon weg, User-LaunchAgent wiederherstellen

**Ziel:** Nur EIN nest-daemon läuft, mit korrekter HOME und identity.

**Schritte:**
1. `apes run --as root -- launchctl bootout system/ai.openape.nest`
2. `apes run --as root -- rm /Library/LaunchDaemons/ai.openape.nest.plist`
3. `apes nest install` (als Patrick) → recreated User-LaunchAgent
4. `tail -f ~/Library/Logs/openape-nest.log` — `troop-ws: connected as …@id.openape.ai` sollte erscheinen (vorausgesetzt M1 ist live geshippt → erfordert troop-deploy)

**Akzeptanzkriterien:**
- [ ] `ps -ef | grep openape-nest | grep -v grep` zeigt genau eine Zeile, uid 501 (patrickhofmann)
- [ ] `launchctl print system/ai.openape.nest` → "Could not find" (System-Daemon weg)
- [ ] `launchctl print gui/$(id -u)/ai.openape.nest` zeigt running, pid > 0
- [ ] nest-log zeigt `troop-ws: connected …` (nicht "not logged in — retry")

**Rollback:** `apes nest uninstall` + falls nötig System-Daemon plist von git restore.

### Milestone 3: E2E am mini

**Ziel:** Spawn-from-troop + config-update beide nachweislich live.

**Schritte:**
1. Edit `igor19`'s `system_prompt` in troop-UI → nest-log innerhalb <2s: `apes run --as igor19 -- apes agents sync` mit success.
2. troop-UI "+ Spawn agent" → name=`testbot`, host=mini, bridge=… → submit. Am mini: escapes-grant-prompt (DDISA via phone/laptop). Approve. → spawn success in UI. `testbot` erscheint in `/agents`.
3. `apes agents destroy testbot` (cleanup).

**Akzeptanzkriterien:**
- [ ] config-update <2s gemessen
- [ ] Spawn-Flow komplett durchgeführt
- [ ] `apes agents list` zeigt neuen agent danach, nach destroy ist er weg

**Rollback:** Wenn etwas hängt: `launchctl bootout gui/$(id -u)/ai.openape.nest`. config-update fällt zurück auf 5min-poll, spawn-UI zeigt "no nest connected" — beides graceful.

## Progress

- [ ] `[YYYY-MM-DD HH:MM]` Milestone 1: WS-server akzeptiert act:agent
- [ ] `[YYYY-MM-DD HH:MM]` Milestone 2: Mini cleanup
- [ ] `[YYYY-MM-DD HH:MM]` Milestone 3: E2E

## Surprises & Discoveries

- 2026-05-12 — Identity-Stack ist bereits gebaut: `apes nest enroll`,
  `apes nest install`, eigenes auth.json mit act:agent JWT, alles in
  `~/.openape/nest/`. Nur die troop-WS-server-side war zu streng.
- 2026-05-12 — Mini hatte heute morgen DOPPELTE Daemons (legacy System +
  korrekter User). Beim cleanup hab ich den falschen entfernt.

## Decision Log

| Datum | Entscheidung | Begründung | Verworfen |
|-------|-------------|------------|-----------|
| 2026-05-12 | Keine `nests` DB-Tabelle, in-memory registry reicht | Nest ist transient (kein langlebiges state), peer-registry ist schon richtig dimensioniert | DB-Tabelle — würde extra migration und sync brauchen ohne Mehrwert |
| 2026-05-12 | act:agent + parseAgentEmail für owner-resolution, kein extra exchange | Verwendet bestehende derivation, kein extra endpoint/token-store | `/api/cli/exchange` mirror — extra layer, kein Mehrwert für nest's bedarf |
| 2026-05-12 | Mini: User-LaunchAgent ist die korrekte Architektur | `apes nest install` schreibt genau das; HOME=~/.openape/nest matcht enroll-output | System-LaunchDaemon mit `_openape_nest` user — wäre sauberer Isolation aber bricht enroll/auth-pfad (kein human auth.json greifbar) |

## Session-Checkliste

1. Plan lesen, Progress prüfen
2. `git status` clean; richtige branch (`feat/nest-identity`)
3. `pnpm turbo run lint typecheck test --filter=@openape/troop` baseline
4. M1 implementieren + committen
5. PR aufmachen, CI grün abwarten, mergen
6. `pnpm release:local` → troop deployen (über GH Actions Deploy-Workflow)
7. M2: Mini cleanup (System-Daemon entfernen, `apes nest install`)
8. M3: E2E-Verifikation

## Outcomes & Retrospective

> nach Abschluss füllen
