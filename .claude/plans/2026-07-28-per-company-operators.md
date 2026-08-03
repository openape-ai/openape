# Per-Company-Operatoren (Block 4, Fortsetzung #1036/#1033)

**Ziel:** Ein Operator-Agent pro Firma in id.openape.ai statt einem globalen.
Damit: YOLO-Policies pro Firma (keine Union → kein Cross-Company-Bleed),
Audit-Attribution pro Firma, Revocation pro Firma. Freigegeben von Patrick
(28.07. abends, „Mach das bitte" auf den skizzierten Block).

## Kontext (self-contained)

Der gated Worker (#1036, live seit 28.07.) führt privilegierte Cockpit-Tasks
via codex-PreToolUse-Hook aus: Bash → `APE_WAIT=1 APES_AUTH_FILE=<op-auth>
ape-shell -c <cmd>`. Grants werden von der Identität in `<op-auth>` requested;
deren YOLO-allow-list (Key: requester+audience am IdP) auto-approved
Rollen-Werkzeuge. Heute gibt es EINE Operator-Identität
(`operator-cb6bf26a+patrick+hofmann_eco@id.openape.ai`) für alles — mit
mehreren Tool-Orgs würden die YOLO-Patterns zur Union über alle Firmen
(markiertes Ceiling in `~/.config/openape-worker/worker.sh` yolo_sync).

**Geklärte Fakten (28.07., nachgemessen):**
- Task-Payload trägt die Org bereits: `task.metadata.company`
  (`apps/openape-troop/server/api/cockpit/agent/tasks/next.post.ts:30`).
- Provisioning-Pfad: `apes agents register --name <n> --public-key-file <pub>`
  (als Patrick; erzeugt Sub-User `<n>-<hash>+patrick+hofmann_eco@id.openape.ai`).
- ape-shell-Identität = Standard-Agent-Token (client_assertion OHNE
  delegation_grant → sub=Operator, aud=apes-cli, 8h). NICHT der
  Delegations-Pfad (sub wäre der Owner).
- troop-Cockpit-Serving + Service-Assertions (zaz) bleiben beim BESTEHENDEN
  Operator — der ist Loop-Transport-Infrastruktur; die neuen Firmen-Operatoren
  sind ausschließlich die Grant-/Werkzeug-Autorität (Trennung Transport/Authority).

## Design

- **Mapping** `~/.config/openape-worker/operators.json`:
  `{ "<orgId>": { "email", "key" (PEM-Pfad), "auth" (auth.json-Pfad) } }`
  Delta Mind (`5fa4cb85-bdba-440d-bc78-477ce6afe11e`) → bestehender Operator
  (Key/op-home wiederverwendet, keine Neuregistrierung).
- **Provisioning** `~/.config/openape-worker/provision-company-operator.sh
  <orgId> <name>`: ed25519-Keypair erzeugen (ssh-Format + PEM wie
  `operator_ed25519[.pem]`), `apes agents register`, op-home anlegen,
  operators.json ergänzen. Idempotent (orgId schon gemappt → no-op).
- **parse.py**: schreibt zusätzlich `org.txt` aus `metadata.company`.
- **cockpit-agent.sh `ensure-op-auth [orgId]`**: mit Org-Arg → Key/auth aus
  operators.json; ohne → Legacy-Single-Operator (bestehender Pfad).
- **worker.sh cockpit_loop (GATED=1)**: Org aus `org.txt`; `yolo_sync` pro Org
  (Ziel = Operator der Org, State-Datei `yolo-synced-<orgId>.txt`, weiterhin
  Pattern-Doppelform `x *` + `bash -c x *`); `ensure-op-auth <org>`;
  auth-Pfad nach `$S/op-auth.txt`. **Fail-closed:** Org ohne Mapping oder ohne
  op-auth → read-only + Log (Owner muss provisionieren).
- **generate_codex**: Hook-Command bekommt den auth-Pfad als argv
  (`… codex-pretooluse-hook.py <auth-pfad>`), gelesen aus `$S/op-auth.txt`.
- **hook.py**: `OP_AUTH = sys.argv[1]` mit Fallback auf den bisherigen Pfad.

## Milestones

**M1 — Verdrahtung (Config-Dateien, kein Repo-Code):** parse.py, operators.json
(Delta-Mind-Eintrag), provision-Script, ensure-op-auth-Org-Arg, worker.sh,
hook argv. Akzeptanz: `bash -n` beide Skripte; `ensure-op-auth
5fa4cb85-…` mintet in das gemappte op-home; hook-Selbsttest mit argv zeigt den
Pfad im Rewrite.

**M2 — Isolation bewiesen (IdP-Ebene):** zweiten Operator provisionieren
(Name `op-test`), YOLO `uname *,bash -c uname *` NUR auf ihn syncen. Akzeptanz:
`APES_AUTH_FILE=<test-auth> ape-shell -c 'uname -a'` → auto-approved + Output;
`APES_AUTH_FILE=<deltamind-auth> ape-shell -c 'uname -a'` → pending (deny +
aufräumen). Beweis: Policies wirken strikt pro Identität.

**M3 — In-Worker-E2E:** Worker-Restart, Cockpit-Task an Delta Mind
(`ape-tasks list --json`) → auto-approved via Mapping-Pfad, Antwort mit echtem
Output; Grant-Record `requester=<deltamind-operator>`, `auto: yolo`.
Danach: Memory/Handover aktualisieren, Bericht.

## Fallen
- IdP-Rate-Limit: yolo set / Token-Mint mit Backoff-Schleife (70 s), nie im
  Sekundentakt.
- Worker läuft live: worker.sh-Edits erst per `launchctl kickstart -k` aktiv.
- `apes agents register`-Namensregel: [a-z0-9-], 1–24, Buchstabe zuerst.
- Stall-Watchdog (#1065): E2E-Kommandos wählen, die auto-approven (kein
  APE_WAIT-Hänger im Worker).

## Status
- [x] Unbekannte geklärt (Payload-Org, Provisioning, Service-Impact)
- [x] M1 · [x] M2 · [x] M3 — **abgeschlossen 28.07. 20:45**

### Ergebnis
- M1: parse.py schreibt `org.txt`; `operators.json` (Delta Mind + op-test);
  `provision-company-operator.sh` (idempotent, PKCS8 via python-cryptography —
  `ssh-keygen -m PEM` liefert bei ed25519 OpenSSH-Format → node
  ERR_OSSL_UNSUPPORTED); `ensure-op-auth <org>`; worker.sh fail-closed;
  Hook nimmt auth-Pfad per argv.
- M2 (Isolationsbeweis): identisches `uname -a`, zwei Identitäten →
  op-test **approved auto:yolo**, Delta-Mind-Operator **pending**. Keine
  Pattern-Union, keine Cross-Company-Wirkung.
- M3 (In-Worker-E2E): Cockpit-Task an Delta Mind → Hook rewritete auf den
  gemappten op-auth-Pfad, Grant `14b7c131` requester=Delta-Mind-Operator,
  **auto:yolo**, `ape-tasks list --json` exit 0 mit echtem JSON-Output.

### Fund unterwegs (#1066, gefixt + released)
`@openape/shapes` löste seine Auth eigenständig auf → **Adapter-Grants**
(uname, echo …) liefen unter der OWNER-Identität, also gegen die falsche
YOLO-Policy und mit falscher Audit-Zurechnung; nur der generische
Session-Pfad (bash -c, ape-tasks/o365-cli) war korrekt. Fix: gleicher
`APES_AUTH_FILE`-Override in `packages/shapes/src/config.ts` (PR #1067,
shapes 0.8.0 / apes 1.33.1). **Die frühere Positiv-Verifikation des
Overrides war ein False Positive** — sie las die von einem roten TDD-Lauf
überschriebene echte `auth.json`. Neue Tests sandboxen daher `HOME`.

### Nachtrag: #1065 + Sicherheits-Fund #1070 (abends, beide erledigt)
- **#1065 geschlossen:** worker-seitig fragt `watch_stall` beim Kill-Entscheid
  einmal am IdP nach einem pending Grant (kein Hang → Timer reset + Owner-Progress
  „⏳ wartet auf deine Freigabe"); upstream gibt ape-shell alle 15 s eine
  stderr-Fortschrittszeile aus (PR #1069, `APES_QUIET_WAIT=1` unterdrückt).
  Der im Issue behauptete Grant-Reuse-Bug war korrektes `once`-Verhalten —
  im Issue korrigiert.
- **#1070 (SECURITY, gefixt + released in apes 1.33.2):** `ape-shell -c` verließ
  die Warteschleife auch per 5-Minuten-Timeout und führte danach BEDINGUNGSLOS
  aus. Freigabepflicht war also durch Aussitzen umgehbar, Grant blieb `pending`
  (Audit-Trail log). Fix: fail-closed mit `CliError`. **Verifiziert:** exit 1
  nach 301 s, kein Kommando-Output, Grant-Record unverändert
  `pending/decided_at:null/used_at:null`.
  Lehre in Memory: [[test-the-refusal-not-the-happy-path]].

### Nachtrag 2: zweite Firma + Wildcard-Policy (Owner-Entscheidung)
- **OpenApe-Org** (Backlog-Check/Dev-Loop) hat einen eigenen Operator
  `op-openape-…` (Mapping in operators.json). Vorher lief sie nach dem
  Block-4-Umbau korrekt fail-closed read-only — der Beweis, dass die Weiche
  greift, und zugleich der Grund fuer die Provisionierung.
- Ihre Dev-Rollen fuehren `*` als Werkzeug. **Nicht** als `--mode allow-list
  --allow '*'` gesynct: im Evaluator gewinnt ein Allow-Treffer VOR jeder
  Risikopruefung, `rm -rf /` waere auto-approved gewesen (`--deny-risk` haette
  daran nichts geaendert). Stattdessen `--mode deny-list` mit der kuratierten
  Liste `YOLO_DANGEROUS` in worker.sh (rm -rf, sudo, mkfs, dd, Pipe-nach-Shell,
  force-push, publish, `apes yolo` selbst …). `yolo_sync` waehlt den Modus
  automatisch anhand eines `*`-Eintrags in allowed.txt.
- **Verifiziert:** `git --version` → approved `auto: yolo`;
  `rm -rf /tmp/…` → `pending` (kein Auto-Approve).

### Offen (bewusst nicht in diesem Block)
- Nur Delta Mind hat heute Werkzeuge; weitere Firmen brauchen je einen
  `provision-company-operator.sh <orgId> <name>`-Lauf (op-test kann als
  Vorlage dienen oder via `apes agents destroy op-test` weg).
- Stall-Watchdog vs. wartende Grants + Grant-Reuse: #1065.
- Stufe-3-Rollen-Scopes (`openape_role`, protocol#9) bleiben der nächste Schritt.
