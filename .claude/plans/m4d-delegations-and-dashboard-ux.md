# Plan: M4δ Revoke-Surface + Dashboard-UX-Audit (org)

## Ziel
1. Der Owner kann die **Cross-SP-Delegationen** (z.B. „org darf auf troop spawnen") **sehen und widerrufen** — schließt die Sicherheitsschleife zum Revocation-Enforcement (troop prüft seit PR #636 live).
2. Die **Dashboard-Buttons** im org-App sind sprechend; ggf. Seiten splitten.

## KRITISCHER Design-Punkt (CORS-Fallstrick)
Liste + Revoke der Delegationen sind **owner-authentifiziert gegen den IdP** (Session-Cookie). Die Owner-IdP-Session lebt im **Browser**, nicht auf dem org-Server (gleicher Bootstrap-Grund wie beim Spawn). Ein Revoke-Panel **im org-App** müsste also browser→IdP `credentials:include` machen = **CORS + sameSite=none wieder einführen** — genau das, was wir gerade entfernt haben.
→ **Die Verwaltungs-Surface gehört an den IdP (id.openape.ai, same-origin).** Das org-Dashboard **verlinkt** nur dorthin (Top-Level-Navigation).

## Bestand (Inventur)
- **IdP-APIs existieren:** `GET /api/grants?section=active` (Session) listet die Standing-/Delegation-Grants des Owners; `POST /api/grants/{id}/revoke` (Session, owner/approver/admin-gated) widerruft. (Unser Cross-SP-Grant ist `type='delegation'`, `request.delegate=org`, `request.audience=troop`, `requester=owner`.)
- **IdP `account.vue`** hat schon „Connected services (consents)" (OIDC-Consents) + WebAuthn/SSH — aber **keine** Delegations-/„Apps acting on your behalf"-Sektion.
- **org `en.json`** hat ungenutzte `delegation.*`-Keys (geplant, nie gebaut).
- **org-Dashboard:** `index.vue` (Liste/Login) + `orgs/[id].vue` (5 Tabs: Chart/Objectives/Cost/Reports/Settings). Buttons sauber gemappt (siehe Audit unten).

## Dashboard-UX-Audit — gefundene Smells (org)
| Stelle | Label heute | Problem / Vorschlag |
|---|---|---|
| MemberCard `chart.linkAgentCta` | „Link existing…" | unklar; → „Link a spawned agent" / „Paste agent email" |
| MemberCard `chart.spawnCta` | „Spawn agent" | verschweigt den einmaligen Consent; → Tooltip/Hint „needs one-time approval" |
| Settings `common.save` | „Save" | überladen (Vision **und** Budget); → „Save changes" + nur dirty zeigen (tut es teils) |
| Settings | (fehlt) | **keine** Delegations-Sicht → neue Card „Delegations" mit Link zum IdP |
| Chart vs Add | „Add member" vs „Spawn agent" | konzeptionell ok (Sitz anlegen vs. besetzen), aber Onboarding-Hint sinnvoll |
**Seiten-Split:** Die 5 Tabs sind angemessen; der eigentliche IA-Mangel ist die **fehlende Delegations-Surface**, nicht zu volle Seiten. Kein Split nötig (YAGNI).

## Milestones
### M4δ-1 — IdP: Delegations-Verwaltung (same-origin, kein CORS)
- Eine Sektion **„Apps acting on your behalf"** in `account.vue` (oder neue `/delegations`-Page), die die aktiven Delegation-Grants des Owners listet: Delegate (org), Audience (troop), Scopes, erteilt-am, `grant_type`.
- **Revoke**-Button pro Eintrag → `POST /api/grants/{id}/revoke` (Session) → Liste refreshen.
- Reuse: bestehende List-/Revoke-APIs; nur UI. Confirm-Dialog („widerrufen? laufende Spawns brechen ab").
- **Akzeptanz:** Owner sieht den org→troop-Grant; Revoke setzt ihn auf `revoked`; ein folgender Spawn failt am troop-Revocation-Check (PR #636) → Schleife geschlossen. E2E + Screenshot.

### M4δ-2 — org: Delegations-Card im Settings-Tab (+ Naming-Polish)
- Settings-Card **„Delegations"** (nutzt `delegation.*`-i18n): Erklärtext + Button „Manage at your IdP" → Top-Level-Link auf `id.openape.ai/account` (bzw. die Delegations-Page). Optional Hinweis im Add-CEO-Flow: „du kannst das jederzeit am IdP widerrufen".
- **Naming-Polish** (nach Patrick-Freigabe, siehe Audit): `linkAgentCta`, `spawnCta`-Hint, `save`-Label. Nur i18n-Strings, kein Logik-Change.
- **Akzeptanz:** Settings zeigt die Card; Link führt same-origin zur IdP-Verwaltung; lint+typecheck grün; Guide-Screenshot.

### M4δ-3 — Guide/Doku
- Optional: kurze Story „Revoke a delegation" oder ein Satz im Add-CEO-Guide. (Entscheiden, ob eigener Guide-Schritt.)

## Offene Entscheidungen (vor Code)
1. **Revoke-Surface-Ort:** IdP-`account.vue`-Sektion (empfohlen, kein CORS) vs. eigene IdP-`/delegations`-Page vs. org-Panel-mit-Redirect. → Empfehlung: Sektion in `account.vue` + org-Settings-Link.
2. **Naming-Changes jetzt mitnehmen** (linkAgentCta/spawnCta/save) oder nur Revoke + Delegations-Card?
3. **Eigener Guide-Schritt „Revoke"** ja/nein.

## Rollout
IdP (additiv: neue Sektion) → org (Settings-Card + i18n). Je eigener PR, CI-grün, deploy `free-idp` dann `org`.

## Status
- [ ] M4δ-1 IdP-Surface  [ ] M4δ-2 org-Card+Naming  [ ] M4δ-3 Guide
