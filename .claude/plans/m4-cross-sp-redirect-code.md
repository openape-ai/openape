# Plan: M4 Cross-SP-Spawn auf Redirect+Code umbauen (CORS raus)

> Supersedet den implementierten M4β-Pfad „B: IdP-CORS + Browser-fetch" zugunsten des
> ursprünglichen Plan-Intents (Redirect → Code, [[org-plan 01KSYCHBQ7]] M4β Schritt 2-4).
> Auth-sensibel + Prod-Impact → **Freigabe vor Implementierung**.

## Warum
Der gebaute Flow lässt den **Browser** (org-Origin) zwei stille Calls gegen den IdP machen
(`findStandingGrant` + `fetchAuthzJwt`, `credentials:include`) → braucht **CORS-Allowlist +
`sameSite=none`-Cross-Origin-Cookies** am IdP (`cors-preflight.ts` + `session.ts`). Das ist
unnötige Angriffsfläche. Patricks Einwand: der Owner ist am IdP authentifiziert — der grant/token-
Teil gehört als **Top-Level-Redirect** dorthin, der org-**Server** holt das Token server-to-server.

## Ziel-Flow (OAuth Authorization-Code + PKCE, bestehende IdP-Infra wiederverwenden)
1. **org-Server** baut Authorize-URL zum IdP: `delegate=org.openape.ai, audience=troop.openape.ai,
   scopes=troop:spawn-agent, grant_type=always, code_challenge=<S256>, redirect_uri=<org-callback>,
   state=<csrf>, member=<email>`. Browser macht **Top-Level-Navigation** dorthin.
2. **IdP** (Owner-Session, same-origin): hat der Owner schon einen Standing-Grant
   (delegate/audience/scope/`always`)? → **ja:** sofort einen **Auth-Code** ausstellen (an
   `code_challenge`+Grant gebunden). **nein:** die bestehende **Consent-Page** (`grant-cross-sp.vue`)
   zeigen → Approve erstellt den Standing-Grant (`grant-cross-sp.post.ts`, unverändert) → Auth-Code.
3. IdP **redirectet zum org-`redirect_uri`** mit `?code=…&state=…` (KEIN JWT in der URL).
4. **org-Server-Callback** löst den Code am IdP-Token-Endpoint ein (`code` + `code_verifier`,
   server-to-server, **kein Cookie/kein CORS**) → bekommt den **AuthZ-JWT** (subject_token,
   `aud=apes-cli, sub=Owner, delegate=org, scopes`). Identisch zum heutigen Token, nur anders geliefert.
5. org-Server fährt den **bestehenden** Pfad weiter: `troop /api/cli/exchange` → `spawn-intent`
   → Member-Row `spawnStatus='pending'` → Poll → `active`. (spawn.post.ts bleibt fast unverändert;
   `subject_token` kommt jetzt aus Schritt 4 statt aus dem Browser.)

**Ergebnis:** Browser macht NUR Navigationen. CORS-Allowlist + sameSite=none für diesen Flow weg.

## Sicherheit (nicht verhandelbar)
- **PKCE S256** (org generiert `code_verifier`, schickt nur `code_challenge`) → Code-Abfangen nutzlos ohne Verifier. Kein Client-Secret nötig (org-SP ist „public" wie apes-cli).
- **Code:** one-time, kurz-TTL (≤60s), an `code_challenge` + `delegate` + `redirect_uri` gebunden; Replay-geschützt (consumed-Flag).
- **`redirect_uri`-Allowlist** am IdP (exakter Match, kein Wildcard) → Open-Redirect/Token-Exfil verhindern. org-Callback-URI vorab registriert (wie apes-cli loopback).
- **`state`** CSRF-Schutz org-seitig (Session-gebunden).
- **Owner-Auth weiterhin Pflicht** am IdP (Session) bevor ein Code ausgestellt wird — bei fehlender Session normaler IdP-Login (Passkey).
- Code-Exchange am IdP authentifiziert den org-SP über `client_id` + PKCE-Verifier (kein geteiltes Secret).

## Betroffene Dateien
**IdP (`modules/nuxt-auth-idp`):**
- `…/routes/authorize.get.ts` (+ `api/authorize/consent.*`): Delegation-Modus — Authorize mit
  `delegate/audience/scopes/grant_type` → Standing-Grant-Check → Code (oder Consent→Code). Möglichst
  als Erweiterung der bestehenden Authorize/Consent-Maschinerie.
- `…/routes/token.post.ts` (oder neuer `…/api/grants/authorize-token`): Code+Verifier → **AuthZ-JWT**
  (statt normalem Access-Token) via vorhandenem `issueAuthzJWT` (heute in `grants/[id]/token.post.ts`).
- `grant-cross-sp.vue` / `grant-cross-sp.post.ts`: in den Authorize-Flow einhängen (Approve → Code), statt eigenständig `grant_id` per `return_to` zurückzugeben.
- **Entfernen/zurückbauen:** CORS-Abhängigkeit — `cors-preflight.ts` Allowlist für diesen Flow nicht mehr nötig; `session.ts` sameSite=none nur noch falls anderweitig gebraucht (prüfen!). `grants/index.get.ts?role=delegator` + `grants/[id]/token.post.ts` als Browser-credentials-Pfad nicht mehr aufgerufen (ggf. behalten für andere Consumer — prüfen).

**org (`apps/openape-org`):**
- `app/pages/orgs/[id].vue`: `findStandingGrant`/`fetchAuthzJwt`/`spawnWithGrant` raus; `onSpawnAgent`
  → `GET /api/orgs/[id]/members/[email]/spawn-authorize` (org-Server baut Authorize-URL + PKCE, setzt state/verifier in Server-Session) → `window.location` dorthin. Return-Handler entfällt großteils.
- **NEU** `server/api/orgs/[id]/members/[email]/spawn-authorize.get.ts`: baut Authorize-URL + PKCE.
- **NEU** `server/routes/oauth/spawn-callback.get.ts` (o.ä.): empfängt `code/state`, validiert state,
  Code-Exchange am IdP → subject_token → ruft die bestehende Spawn-Logik → redirect zurück auf `/orgs/[id]`.
- `server/api/orgs/[id]/members/[email]/spawn.post.ts`: zu interner Funktion refactoren, die der Callback
  mit dem server-seitig geholten subject_token aufruft (kein Body-subject_token aus dem Browser mehr).

**local-stack:** `NUXT_OPENAPE_IDP_CORS_ALLOWED_ORIGINS` (gerade testweise gesetzt) wird **wieder
entfernt** — der neue Flow braucht es nicht.

## Milestones (je unabhängig verifizierbar, max. 1/Session)
- **M0 — Baseline & Spike-Findings festhalten.** (DONE im Spike: org-SSO+create-org+add-member laufen
  im local-stack; einzige Lücke war CORS bei `findStandingGrant`. Beweist: nur der grant/token-Teil ist betroffen.)
- **M1 — IdP: Delegation-Authorize+Code+Exchange.** Authorize-Endpoint (Delegation-Modus, PKCE) +
  Token-Exchange→AuthZ-JWT. Unit/Integration: Code one-time, PKCE-Mismatch→reject, redirect_uri-Allowlist,
  Standing-Grant→skip-Consent. **Akzeptanz:** Test-Suite grün; manueller curl/headless: Authorize→Code→Exchange liefert gültigen AuthZ-JWT (`aud=apes-cli, sub=owner, delegate=org`).
- **M2 — org: authorize-redirect + server-callback + Spawn refactor.** **Akzeptanz:** im local-stack
  (Nest gebunden, `--no-deps`) klick-äquivalent: Spawn → Redirect IdP → (Consent) → Callback → CEO `active`.
  **OHNE** `NUXT_OPENAPE_IDP_CORS_ALLOWED_ORIGINS`.
- **M3 — CORS/sameSite-Rückbau + Regressions-Check.** Allowlist-Dep entfernen wo möglich; prüfen, dass
  kein anderer Flow (chat/troop) sie noch braucht. **Akzeptanz:** lint+typecheck+betroffene Tests grün; bestehende cross-SP-Consumer unverändert funktionsfähig.
- **M4 — E2E-Story + Guide (das ursprüngliche Ziel).** `compose/agent/org-ceo.mjs` fährt den neuen Flow
  (create-org→CEO-Sitz→Consent-Redirect→CEO aktiv), `distribute-docs.mjs` → org-`/docs`-Guide „Add a CEO".
  **Akzeptanz:** Re-Run = 0 PNG-Diffs (Determinismus #632); `org.openape.test/docs/add-ceo` rendert; Screenshot an Patrick.

## Rollout / Backward-Compat (Prod)
- Prod-org+IdP laufen den CORS-Flow. Umstellung: IdP-Seite (neue Authorize/Exchange) ist additiv →
  zuerst deployen, alter Pfad bleibt. Dann org auf den neuen Flow. Erst danach CORS-Allowlist am IdP entfernen.
- Reihenfolge der PRs: IdP (additiv) → org (Umschalten) → IdP-Cleanup (CORS raus). Jeder mit grünem CI, getrennt mergebar.
- Jeder Schritt einzeln deploybar (`deploy:image idp` / `org`), Rollback per Tag-Pin.

## Offene Fragen (vor M1 klären)
1. **Reuse-Grad:** den bestehenden `authorize.get.ts`/`token.post.ts` erweitern (Delegation-Modus als
   zusätzlicher `response`-Pfad) ODER dedizierte `…/api/grants/authorize` + `…/authorize-token`? — Tendenz: dedizierter Delegation-Authorize, um den OIDC-Login-Pfad nicht zu verkomplizieren, aber PKCE/Code-Store teilen.
2. **AuthZ-JWT-TTL** (heute via `grants/[id]/token`): unverändert übernehmen.
3. **Bleiben `grants/index.get.ts?role=delegator` + `grants/[id]/token.post.ts` als Browser-Endpoints** für
   andere Consumer (M4δ Owner-Grant-Management)? → falls ja, CORS evtl. nur dort nötig → in M3 prüfen.

## Status
- [x] M0 Spike-Findings  [ ] M1 IdP  [ ] M2 org  [ ] M3 CORS-Rückbau  [ ] M4 Story+Guide
