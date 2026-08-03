# Session-Handover 2026-07-30 — IdP-Design-System, Shapes-Track, Grant-System

> Self-contained: von oben nach unten lesbar, ohne Vorwissen ausführbar.
> Vorgänger-Kontext: `.claude/plans/2026-07-29-compound-shapes-grants.md` (Shapes-Track,
> Progress-Section dort ist aktuell) und `.claude/plans/2026-07-28-session-handover.md`.

## SOFORT: zwei Security-Fixes liegen undeployed

`main` enthält zwei sicherheitsrelevante Commits, die **nicht in Prod** sind. Der letzte
free-idp-Deploy war `prod-a556003c`; seither gemerged:

| Commit | Was |
|---|---|
| `f918c572` | **deny-Patterns sind ein Veto in BEIDEN Modi** (#1108, diese Session) — vorher waren sie im allow-list-Modus inert, ein zu breites Rollen-Muster gab `mail send` frei |
| `f179e0cb` | **RP-scope passkey-graft gate, add-device tokens an RP binden** — aus einer PARALLELEN Session, nicht von hier |

```bash
cd ~/Companies/private/repos/openape/openape-monorepo.worktrees/idp-design-system
git checkout main && git fetch origin && git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm run deploy:image free-idp
```

Abnahme: `✓ free-idp healthy (prod-<sha>)` im Output, `curl -s https://id.openape.ai/api/health`.
Der Deploy-Guard prüft selbst, dass HEAD `origin/main` enthält.

**Zwischenstand-Absicherung:** Das Loch, das `f918c572` schließt, ist derzeit durch den
OUTWARD-Guard in `worker.sh` (bereits live) abgedeckt — breite `<cli> *`-Rollenmuster werden
beim Sync verworfen. Prod ist also nicht offen, aber die zweite Verteidigungslinie fehlt.

## Merge-bereit: PR #1109

**„Die Karte sagt, WARUM ein Grant wartet"** — https://git.openape.ai/openape-ai/openape/pulls/1109,
Head `9391318f`, **alle Checks grün** (CI, e2e, preview — Stand Session-Ende). Nicht gemergt,
weil der Kontext auslief.

1. Merge via API (Muster unten), `{"Do":"merge"}` — squash-merge wirft auf diesem Forgejo HTTP 500.
2. Changeset ist im PR enthalten (`nuxt-auth-idp` minor) → `pnpm changeset version`, eigener
   PR `chore: version packages`, mergen.
3. `pnpm release:dry` prüfen, dann `pnpm release` (npm-Login als `patrick-hofmann` steht).
4. `pnpm run deploy:image free-idp`.
5. Abnahme: auf einer wartenden Approval-Karte erscheint die Sektion **„Why this is waiting"**
   mit dem Segment, dem ein Pattern fehlt.

## Was diese Session fertiggestellt hat (alles live, wenn nicht anders vermerkt)

| Thema | PRs | Prod |
|---|---|---|
| IdP-Design-System (Frame, Tokens, Identity-Record, /consent+/denied) | #1092, #1093 | `prod-d836f079` |
| YOLO: `bash -c` auspacken → Patterns matchen das Kommando | #1094 | `prod-4ff1cddc` |
| Shapes-Track M1–M5 (Compound segmentweise, Regel-UX, Registry) | #1095, #1096, #1098, #1101 | `prod-a556003c` + npm (apes 1.34.0, shapes 0.9.0, core 0.20.0, grants 0.13.0, nuxt-auth-idp 0.33.0) |
| Worker-Drift ins Repo, `yolo_sync`-Fixes | #1105 | troop `prod-60a950a9` |
| Nur die fertige Antwort pusht (kein „Operator denkt …") | #1106 | troop `prod-60a950a9` |
| Worker-Drift-Check beim Start | #1107 | troop `prod-1cdf882b` |
| deny-Veto in beiden Modi | #1108 | **NICHT deployed** |
| Karte erklärt „warum pending" | #1109 | **grün, nicht gemergt** |

## Betriebszustand

**Standing Grants** (laufen bis **2026-08-06**, `max_risk: low`, danach kommen Karten zurück):
- Delta Mind `op-delta-mind`: `o365` (e5dc03ba) + `jq` (7583227a)
- IURIO `op-iurio`: `o365` (1ee47292) + `jq` (1aff73cf)
- privat `op-privat`: `gmail` (eedbb528) + `jq` (d1034b65)

**Rollen-`tools`**: `jq`/`jq *` in allen drei Mail-Rollen. Die Delta-Mind-Rolle **„Buchhaltung"**
wurde von `o365-cli *` auf Verben eingeschränkt (list/read/search/query/attachments/move +
pdftotext + jq) — sie beschreibt sich selbst als read-only.

**YOLO-Policies**: alle vier Orgs synced. Delta Mind: 33 allow + 24 deny.
Prüfen: `apes yolo show --agent <op-email> --audience ape-shell --json`.

**Registry** (`openape-ai/shapes-registry@523f76f`, GitHub): `gmail` + `jq` neu, 26 Adapter ohne
Risiko-Gefälle entfernt. `awk`/`sed` bewusst OHNE Adapter (`awk 'BEGIN{system()}'`, `sed -i`).

## Verifikations-Harness (dauerhaft gesichert)

`~/.openape/dev-harness/` — rettet das, was sonst pro Session neu gebaut werden müsste.
Details in der Memory `idp-auth-gated-screenshot-harness`.

```bash
# 1. Wegwerf-IdP (in-memory DB, eigene Secrets)
cd ~/Companies/private/repos/openape/openape-monorepo.worktrees/idp-design-system/apps/openape-free-idp
NUXT_IGNORE_LOCK=1 OPENAPE_E2E=1 \
  OPENAPE_ISSUER=http://127.0.0.1:3009 OPENAPE_RP_ORIGIN=http://127.0.0.1:3009 \
  OPENAPE_RP_ID=127.0.0.1 OPENAPE_RP_HOST_ALLOWLIST=127.0.0.1 \
  OPENAPE_SESSION_SECRET=design-review-session-secret-0123456789 \
  OPENAPE_MANAGEMENT_TOKEN=design-review-management-token \
  OPENAPE_ADMIN_EMAILS=patrick@hofmann.eco \
  NUXT_TURSO_URL=file::memory: NUXT_TURSO_AUTH_TOKEN= \
  npx nuxt dev --port 3009 --host 127.0.0.1

# 2. Seeden + Session-Cookie minten (Passkey ist headless nicht fahrbar)
cd ~/.openape/dev-harness && BASE=http://127.0.0.1:3009 node seed.mjs | grep COOKIE | sed 's/COOKIE=//' > cookie.txt

# 3. Screenshots aller Routen (CDP, weil --screenshot keine Cookies kann)
node shoot.mjs shots 1280 1400            # Desktop
node shoot.mjs shots-mobile 390 844       # echtes Mobile via Emulation.setDeviceMetricsOverride
STANDALONE=1 node shoot.mjs shots-pwa 390 844   # PWA-Modus (Push-Banner sichtbar)
python3 sheet.py shots sheet.png 5        # Kontaktbogen

# 4. Compound-Grant-E2E (Union-Standing-Grants)
node compound-e2e.mjs
```

**Nach `git pull` im Worktree**: der `iron-webcrypto`-Symlink zeigt in die pnpm-Store und kann
brechen — dann `ln -sfn $(ls -d <repo>/node_modules/.pnpm/iron-webcrypto@*/node_modules/iron-webcrypto) ~/.openape/dev-harness/iron-webcrypto`.

## Arbeitsumgebung

- **Worktree**: `~/Companies/private/repos/openape/openape-monorepo.worktrees/idp-design-system`
  (aktuell auf `feat/why-pending-explanation`). Hier arbeiten, **nicht** im Primary-Checkout —
  der ist multi-agent shared und stand bei Session-Beginn 162 Commits hinter main.
- **Push**: `--no-verify` nötig. Das pre-push-Audit-Gate blockt **jeden** Push (13 high
  advisories in transitiven prod-Deps: brace-expansion, svgo, sharp, postcss, fast-uri).
  Vorbestehend, von Patrick abgesegnet. Forgejo-CI prüft Audit nicht.
- **PR/Merge** nur über die API (`~/.netrc`-PAT):
  ```python
  import json, netrc, urllib.request
  host="git.openape.ai"; user,_,token=netrc.netrc().authenticators(host)
  req=urllib.request.Request(f"https://{host}/api/v1/repos/openape-ai/openape/pulls/<NR>/merge",
      data=json.dumps({"Do":"merge"}).encode(), method="POST",
      headers={"Authorization":f"token {token}","Content-Type":"application/json"})
  urllib.request.urlopen(req)
  ```
- **troop-API**: Token aus `~/.config/apes/sp-tokens/troop.openape.ai.json`, Key ist
  **`access_token`** (nicht `token` — kostete eine Runde 401er).

## Teuer gelernte Fallen dieser Session

1. **Eine Fehlermeldung kann lügen.** `[yolo] sync failed (rate-limit?)` stand so im Code —
   26 Log-Zeilen, zwei Tage stale Policy. Der echte Fehler war `HTTP 400: allowPatterns may
   contain at most 64 entries`, sichtbar erst nach `2>&1` statt `>/dev/null`. Kein Retry heilt
   einen 4xx. **Nie eine Vermutung im Code als Diagnose übernehmen.**
2. **Ein Fix kann ein Loch aufreißen.** Die stale Policy hatte `mail send` zufällig blockiert.
   Frisch gesynct wäre es freigegeben gewesen, weil `YOLO_DANGEROUS` nur im deny-list-Zweig
   griff. Nach einem Sicherheits-nahen Fix immer die **Verweigerung** nachmessen, nicht nur
   den Happy Path.
3. **`ape-shell` ohne `APE_WAIT` druckt immer „pending approval"** — auch bei längst
   auto-freigegebenem Grant. Wahrheit ist der Grant-Record (`status`/`auto_approval_kind`).
4. **Ein Live-Registry ist eine Zeitbombe in Unit-Tests.** Der Compound-Test nutzte `jq` als
   „unshaped"-Beispiel; sobald der jq-Adapter published war, installierte der Test ihn selbst
   nach und widerlegte sich. Jetzt Nonsense-Executable. `SHAPES_REGISTRY_URL` in `beforeAll`
   greift nicht (Modul-Konstante).
5. **Der Äquivalenz-Test fand einen echten Bug in der Diagnose** (allow-list ignorierte den
   Risk-Pfad → Karte hätte „kein Pattern deckt das" behauptet, wo der Evaluator freigibt).
   Eine Erklärung, die der Entscheidung widersprechen kann, ist schlimmer als keine.
6. **Worker-Drift**: `~/.config/openape-worker/` war 474 Zeilen vor dem Repo. Jetzt prüft
   `drift_check` das beim Start selbst. Meldet beide Richtungen, überschreibt nie.
7. **headless Chrome `--window-size=390`** rendert breiter und schneidet ab — echtes Mobile
   nur über CDP `Emulation.setDeviceMetricsOverride`, sonst diagnostiziert man Overflow,
   den es nicht gibt.

## Offene Owner-Entscheidungen (nichts davon blockiert)

- **Grant-System-Vereinfachung**, Punkte 3+4 der Liste: (3) Drift zwischen Rollen-`tools` und
  aktiver Policy im Cockpit sichtbar machen, mit Alter; (4) YOLO als „Standing Grant mit
  Glob-Matcher" konsolidieren statt zweitem System. Punkte 1+2 sind erledigt (#1108, #1109).
- **Audit-Gate**: Deps fixen oder Ignore-Liste — aktuell trainiert es `--no-verify`.
- **`agents/[id].vue`** löscht einen Agent auf einen Klick **ohne Rückfrage**.
- **Sprachmischung DE/EN** im IdP, teils auf einer Seite; `app.vue` setzt hart `lang="en"`.
- **`/docs`** lebt in eigener zinc-Welt, will 6xl-Zweispalter.
- **Low-Risk-Adapter** für weitere Filter-Tools (grep/head/tail/cut) — würde Pipes auf dem
  strukturierten Weg weiter entschärfen. `awk`/`sed` bewusst nicht.

## Session-Checkliste für die Folge-Session

1. Worktree auf `origin/main`? (`git fetch && git status`)
2. **Priorität 1**: `deploy:image free-idp` (zwei Security-Fixes hängen).
3. #1109 ist grün → merge → `changeset version` (PR) → `release` → `deploy:image free-idp`.
4. `apes grants inbox --json` — stehen unerwartete Karten? Mail-bezogene sollten 0 sein.
5. Vor Worker-Änderungen: `diff apps/openape-troop/public/worker/worker.sh ~/.config/openape-worker/worker.sh`
   (bzw. den `[drift]`-Log-Eintrag lesen).

---

## Erledigt (Folge-Session, 2026-07-30 nachmittags)

- ✅ Security-Deploy: `prod-133ec0f5` (deny-Veto #1108 + RP-scoped passkey-graft live)
- ✅ PR #1109 gemerged (`4295cb14`) → Version-PR #1110 (nuxt-auth-idp 0.34.0) gemerged →
  `@openape/nuxt-auth-idp@0.34.0` published → `prod-6cf0ee4d` deployed
- ✅ Abnahme visuell bestanden: „Why this is waiting" auf der Approval-Karte zeigt das
  unmatched Segment (yolo) + die standing-grant-Erklärung (Screenshots via Harness,
  `~/.openape/dev-harness/shots-why/`)
- ⚠️ Grant-Inbox: 20 pending Karten, überwiegend op-openape-Dev-Loop; entgegen Erwartung
  auch mail-/kalendernahe (eacbb15e, 825560b8, 2× "List today's events") — Owner-Review offen
- Offen: Punkt 3 der Grant-Vereinfachung (Drift Rollen-tools ↔ aktive Policy im Cockpit)

## Standing Grants verlängert (2026-07-30 abends)

Alle 6 bis **2026-09-06 23:59** (max_risk low, unverändert). Neue IDs (alte revoked):
- Delta Mind: o365 d47131c0 · jq 809b53a1
- IURIO: o365 833d899f · jq b936b426
- privat: gmail 628fe8db · jq c43bc209
