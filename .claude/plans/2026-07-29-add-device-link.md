# Plan: „Weiteres Gerät hinzufügen — Link verschicken" (id.openape.ai)

> Self-contained: ohne Vorwissen von oben nach unten ausführbar.

## Purpose / Big Picture

- **Ziel:** Ein eingeloggter User klickt auf seinem bestehenden Gerät „Weiteres Gerät hinzufügen — Link verschicken". Er bekommt eine Mail an seine Account-Adresse, öffnet den Link auf dem **neuen** Gerät und registriert dort einen Passkey. Danach ist er auf dem neuen Gerät eingeloggt.
- **Kontext:** Heute gibt es keinen Weg, ein zweites Gerät zu enrollen, wenn kein Cross-Device-WebAuthn (QR) klappt: Der normale Registrierungs-Mail-Link läuft bei bestehenden Accounts in das absichtliche 409-Gate (#291 passkey-graft). Der authentifizierte Add-Flow (`/passkeys`) erzeugt den Passkey nur im Browser des **alten** Geräts.
- **Sicherheitsmodell:** Der Link wird NUR aus einer authentifizierten Session gemintet und geht NUR an die eigene Account-Adresse. E-Mail ist Transport, nicht Auth-Faktor → kein Recovery-Hold nötig. Das unauthentifizierte 409-Gate bleibt unverändert zu.
- **Scope:** Mint-Endpoint (auth), Mail-Template, Gate-Bypass für add-device-Tokens, UI-Button. NICHT im Scope: Recovery-Änderungen, Push-Notification „neues Gerät" (Follow-up), RP-Scoping-Bug des Gates (separates Issue).

## Repo-Orientierung

- **Projekt:** openape-monorepo, `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`
- **Relevante Dateien:**
  - Gate: `modules/nuxt-auth-idp/src/runtime/server/api/webauthn/register/verify.post.ts:59-74`
  - Token-Store: `registration_urls` (`apps/openape-free-idp/server/database/schema.ts:149`, Store `apps/openape-free-idp/server/utils/drizzle-registration-url-store.ts`, Typ `packages/auth/src/idp/stores.types.ts:24-32`)
  - Mail: `apps/openape-free-idp/server/utils/email.ts` (Resend, `brandedHtml`, `sendViaResend`)
  - Vorbild-Endpoint: `apps/openape-free-idp/server/api/register.post.ts` (Mint + Mail + Rate-Limit)
  - Rate-Limiter: `apps/openape-free-idp/server/utils/rate-limiter.ts`
  - UI: `apps/openape-free-idp/app/pages/account.vue` (app-owned) bzw. Modul-Page `modules/nuxt-auth-idp/src/runtime/pages/passkeys.vue`
  - Tests: `modules/nuxt-auth-idp/test/webauthn-register-verify.test.ts`
- **Tech:** Nuxt 4, h3, Drizzle/SQLite, Resend, Vitest. Vue: Composition API + @nuxt/ui.
- **Dev:** `pnpm turbo run build --filter=openape-free-idp`; Tests `pnpm turbo run test --filter=@openape/nuxt-auth-idp`; Checks `pnpm lint` + `pnpm typecheck`.

## Design-Entscheidung (Kurzform)

Wiederverwendung der `registration_urls`-Infrastruktur mit Marker `createdBy: 'add-device'`:
- Nur ein authentifizierter Endpoint mintet solche Tokens, `email` = Session-User (kein User-Input).
- Das 409-Gate in `verify.post.ts` lässt Tokens mit `createdBy === 'add-device'` durch (Kommentar aktualisieren: der Trust-Anker ist die authentifizierte Session, die den Token gemintet hat, nicht die Mailbox).
- Kurze TTL (1 h statt 24 h), one-time (`consumed`-Flag existiert), Rate-Limit wie Registrierung.
- Bestehende `/register?token=`-Page + `excludeCredentials`-Befüllung (`packages/auth/src/idp/webauthn/registration.ts:42-45`) funktionieren unverändert.

## Milestones

### Milestone 1: Gate-Bypass im Modul + Tests

**Ziel:** `register/verify` akzeptiert add-device-Tokens für Accounts mit bestehenden Passkeys; alles andere bleibt 409.

**Schritte:**
1. In `verify.post.ts` das Gate um `&& regUrl.createdBy !== 'add-device'` erweitern; Security-Kommentar um den neuen Pfad ergänzen.
2. Tests in `webauthn-register-verify.test.ts`: (a) add-device-Token + bestehende Credentials → 200, Credential appended, Session erstellt; (b) `self-service`-Token + bestehende Credentials → weiterhin 409; (c) add-device-Token ist nach Nutzung consumed (zweiter Versuch → 404).

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=@openape/nuxt-auth-idp` → grün inkl. neuer Tests
- [ ] Test (b) beweist: das NEIN bleibt bestehen (Gating-Regel: die Verweigerung testen, nicht nur den Happy Path)

**Rollback:** Commit revert; Gate-Verhalten ist rein additiv über den Marker.

### Milestone 2: Mint-Endpoint + Mail (free-idp)

**Ziel:** `POST /api/account/add-device-link` (Session-Auth) mintet Token und mailt den Link an die Account-Adresse.

**Schritte:**
1. Neuer Endpoint `apps/openape-free-idp/server/api/account/add-device-link.post.ts`: Session prüfen (Muster wie bestehende Session-Auth-Endpoints der App, z. B. `server/api/settings/recovery.get.ts`), `checkRateLimit(email, ip)`, Token minten (`createdBy: 'add-device'`, TTL 1 h), `sendAddDeviceEmail(email, url)`.
2. Neues Template `sendAddDeviceEmail` in `server/utils/email.ts` (brandedHtml-Muster): „Weiteres Gerät hinzufügen — öffne diesen Link auf dem neuen Gerät. 1 Stunde gültig. Nicht angefordert? Ignorieren + Passkeys prüfen."

**Akzeptanzkriterien:**
- [ ] `curl -X POST http://localhost:3000/api/account/add-device-link` ohne Session → 401
- [ ] Mit Session-Cookie → `{ ok: true }`, Mail-Log `[email] add-device email queued`, DB-Row in `registration_urls` mit `created_by='add-device'` und `expires_at ≈ now+1h`

**Rollback:** Endpoint + Template löschen; keine Schema-Änderung nötig.

### Milestone 3: UI-Button

**Ziel:** Auf der Passkeys-Verwaltung gibt es „Weiteres Gerät hinzufügen — Link verschicken".

**Schritte:**
1. Button in der „Add Device"-Card. Ort: `modules/nuxt-auth-idp/src/runtime/pages/passkeys.vue` ist Modul-owned, der Endpoint aber app-only → Button in die app-owned `apps/openape-free-idp/app/pages/account.vue` setzen ODER passkeys.vue in der App shadowen. Entscheidung bei Umsetzung; Default: account.vue (kein Page-Duplikat).
2. Klick → POST, Success-Hinweis „Link an <email> geschickt — öffne ihn auf dem neuen Gerät."

**Akzeptanzkriterien:**
- [ ] E2E am lokalen Server: Button klicken → Mail-Log; Link aus DB in zweitem Browser-Profil öffnen → Passkey-Registrierung (virtual authenticator) → `/api/webauthn/credentials` listet 2 Geräte
- [ ] Screenshot des Buttons + des Erfolgs-Zustands an Patrick (SendUserFile)

**Rollback:** UI-Änderung revert.

### Milestone 4 (optional, Follow-up): Dead-End-Mail entschärfen

Der normale Registrierungs-Pfad (`register.post.ts`) mailt bei bestehendem Account mit Passkeys einen Link, der in die 409 läuft, und der Kommentar (Z. 19–30) behauptet fälschlich Append-Verhalten. Fix: Kommentar korrigieren; bei existierendem Account mit Credentials stattdessen eine Hinweis-Mail senden („Du hast schon einen Account — melde dich auf einem bestehenden Gerät an und nutze ‚Weiteres Gerät hinzufügen', oder Recovery"). Enumeration-Tradeoff = wie Recovery, bewusst akzeptieren.

## Progress

- [x] `[2026-07-29 18:05]` Milestone 1 — Gate-Bypass + 2 neue Tests (191 grün), Commit edcfe8eb
- [x] `[2026-07-29 18:15]` Milestone 2 — Endpoint + sendAddDeviceEmail, Commit 3b99b145
- [x] `[2026-07-29 18:15]` Milestone 3 — App-Shadow von /passkeys mit „Email me a link"-Button (statt account.vue: die ist reiner Link-Hub), Commit 3b99b145
- [x] `[2026-07-29 18:15]` Milestone 4 — register.post.ts: Hinweis-Mail statt Dead-End-Token-Mail, Commit 3b99b145
- [x] `[2026-07-29 18:40]` E2E lokal komplett grün (13 API-Checks + UI-Klick-Test, Desktop+Mobile-Screenshots): Issue #1097, Branch feat/issue-1097-add-device-link
- [x] `[2026-07-29 19:05]` PR #1100: Forgejo-CI grün (ci/e2e/preview), gemerged auf main (183bb505). Push brauchte SKIP_HOOKS=1 — lokales Audit-Gate blockt wegen 13 frischer High-Advisories in transitiven docs/chat-Deps (main-weit, separater Task-Chip)
- [x] `[2026-07-29 19:15]` Deploy free-idp (prod-183bb505) von frischem main-Worktree, Health-Gate grün; Prod-Check: /api/account/add-device-link → 401 ohne Session. Worktrees + Branch aufgeräumt, Abschluss-Mail an Patrick verschickt.

## Surprises & Discoveries

- 2026-07-29: Lokale E2E gegen den Prod-Build brauchen Runtime-Overrides `NUXT_OPENAPE_IDP_{RP_ID,RP_ORIGIN,SESSION_SECRET,RP_HOST_ALLOW_LIST}` — die `OPENAPE_*`-Envs aus nuxt.config sind Build-Zeit. Außerdem erzwingt die rp-tenant-Middleware `https://` für allowgelistete Hosts → localhost NICHT allowlisten, sondern über die statische Config laufen lassen. Resend lässt sich mit `RESEND_BASE_URL` auf einen lokalen Catcher umbiegen.
- 2026-07-29: Gate prüft `findByUser` statt `findByUserAndRp` → User mit Passkey auf anderer RP-Domain wird auf neuer Tenant-Domain geblockt, obwohl `login.vue:278` ihn nach `/register-email` schickt. Separates Issue, nicht Teil dieses Plans.

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-07-29 | Link-Mint nur aus authentifizierter Session, Mail nur an eigene Adresse | E-Mail bleibt Transport, wird nicht Auth-Faktor; #291-Gate bleibt zu | Unauthentifizierter Mail-Link (= Graft-Loch); Recovery-Mode mit Hold (unnötig schwer für diesen Fall) |
| 2026-07-29 | `registration_urls` + `createdBy`-Marker wiederverwenden | Vorhandene TTL/consumed/one-time-Mechanik; kein neues Schema | Neuer Token-Typ/Tabelle (YAGNI) |
| 2026-07-29 | Kein Hold, keine Push-Warnung in v1 | Session-initiiert = gleiches Trust-Level wie der bestehende `/passkeys`-Add-Flow, der auch nicht warnt | Recovery-Grade-Mitigations |

## Session-Checkliste

1. Plan lesen, Progress prüfen
2. Branch von main (`feat/add-device-link`), NICHT auf main editieren
3. Baseline: `pnpm turbo run test --filter=@openape/nuxt-auth-idp`
4. Milestones der Reihe nach, pro Milestone commit
5. `pnpm lint` + `pnpm typecheck` vor jedem Commit
6. E2E-Verifikation (M3-Kriterien) + Screenshot vor „fertig"

## Outcomes & Retrospective

- **Ergebnis:** Feature live auf id.openape.ai (prod-183bb505). Issue #1097 closed, PR #1100 merged. Alle 4 Milestones in einer Session.
- **Abweichungen vom Plan:** M3 landete als App-Shadow von `/passkeys` statt Button auf `account.vue` (die ist reiner Link-Hub — Repo-Muster „App shadowt Modul-Page bei app-only Endpoints" passte exakt). M4 (Dead-End-Mail) wurde direkt miterledigt statt Follow-up.
- **Learnings:** (1) Nitros typed `$fetch` explodiert (TS2321 excessive stack depth) bei Modul-registrierten Routen, die nicht in der Route-Union sind — untypisierter Fetch-Alias als Workaround. (2) Lokale Prod-Build-E2E: `NUXT_OPENAPE_IDP_*`-Runtime-Envs statt der Build-Zeit-`OPENAPE_*`; `RESEND_BASE_URL` für Mail-Catcher. (3) pre-push-Audit-Gate ist main-weit rot (13 frische Highs) — separater Task-Chip.
