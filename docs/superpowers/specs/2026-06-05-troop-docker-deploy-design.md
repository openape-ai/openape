# Tested-Image Docker Deploy (Pilot: troop) — Design

**Datum:** 2026-06-05
**Status:** Freigegeben (Design) — bereit für `writing-plans`
**Auslöser:** Nach dem Docker-Re-Framing (Nest + LLM laufen als Container) soll *jede* App dockerfähig werden und Prod **getestete Images** deployen, die lokal mit Docker bereits verifiziert wurden — so läuft in Prod bit-identisch das Artefakt, das getestet wurde. Motiviert durch die Environment-Drift-Saga (macOS↔Linux-Nest, `:ro`-Mount, Versions-Skew): Docker-first-Parity eliminiert genau diese Fehlerklasse.

## Scope

**Pilot: nur `openape-troop`.** Die komplette Pipeline (`buildx` multi-arch → GHCR → chatty `docker compose` → nginx unverändert → Health → Rollback) wird an EINER zustandslosen, vertrauten App end-to-end in Prod bewiesen. org/chat/free-idp/docs folgen mechanisch in einem **Folge-Spec** — das Design faktorisiert Reuse (Base-/Builder-Muster, generischer Deployer), damit der Rollout Copy-Paste ist.

## Grounding (verifizierter Ist-Zustand, 2026-06-05)

- **Fronting:** jede chatty-App = systemd-Service auf einem localhost-Port (troop = **3010**), davor ein **nginx-vhost** (TLS + `*.openape.ai`-Routing). Deploy heute: `scripts/deploy-troop.sh` → rsync `.output` → Symlink `current` → `systemctl restart openape-troop.service` → Health-Check auf `:3010` → alte Releases prunen. SSH als `openape@chatty.delta-mind.at`, passwortloses sudo für den Service-Restart.
- **State:** troop + free-idp nutzen **LibSQL via remote Turso** (`config.tursoUrl` + `tursoAuthToken` in `apps/openape-troop/server/database/drizzle.ts`). DB ist in der Cloud → **App-Container sind zustandslos** (kein DB-Volume, nur Turso-URL+Token als Env).
- **Docker-Präzedenz:** `apps/openape-nest/Dockerfile` + `apps/openape-llm/Dockerfile` + `compose/docker-compose.yml` zeigen das Muster (multi-stage build aus dem Monorepo-Kontext, `pnpm install --frozen-lockfile` + `pnpm --filter <pkg> build`, Runtime `node:22-bookworm-slim`). Diese laufen lokal als `:dev`-Images (kein Registry).
- **troop ist Nuxt 4 / Nitro** (`node-server`-Preset → `.output/server/index.mjs`, weitgehend self-contained).

## Locked Decisions

1. **Image-Delivery: GHCR-first, registry-agnostisch.** `ghcr.io/openape-ai/<app>`; **`REGISTRY` ist eine Config-Variable** (default `ghcr.io/openape-ai`) → späterer Wechsel auf self-hosted `registry:2` ist ein One-Liner, kein Rewrite. GHCR-Container-Storage+Bandbreite sind **aktuell gratis** (auch privat) laut GitHub-Doku (Caveat „may change with advance notice" → genau dafür der agnostische Hedge).
2. **Build-Arch: Multi-arch via `docker buildx`** (`linux/arm64,linux/amd64` in ein Manifest). Mac (arm64) testet lokal arm64; chatty (amd64) zieht amd64 — selbe Layer/Dockerfile/Deps, nur Arch-Slice unterschiedlich (Parity auf Dependency/Env-Ebene, wo praktisch alle Bugs sitzen).
3. **Orchestrierung auf chatty: `docker compose`**, Container published auf `127.0.0.1:3010` → **nginx/TLS bleibt unangetastet** (vhost zeigt schon dorthin). Eine gemeinsame `compose/chatty.yml` für die chatty-Web-Apps; gezielte Single-Service-Updates (`docker compose up -d openape-troop`).
4. **Secrets/Env:** troops Env (Turso-URL+Token, Management-Token, IdP-URL etc.) wandert vom systemd-Unit in ein **gitignored `.env` auf chatty** (compose `env_file`) — **nie ins Image gebacken**.
5. **Cutover-Sicherheit:** das systemd-Unit `openape-troop.service` bleibt während des Pilots **dormant als Sofort-Fallback** (gestoppt+disabled, nicht gelöscht). Erst nach bestätigtem Pilot wird es im Rollout-Spec entfernt.

## Architektur (End-to-End)

```
Mac:    docker buildx build --platform linux/arm64,linux/amd64 \
          -t $REGISTRY/openape-troop:<gitsha> --push .
          (vorher lokal: docker compose -f compose/chatty.yml up openape-troop  → arm64-Smoke)
chatty:  docker compose -f compose/chatty.yml pull openape-troop
          docker compose -f compose/chatty.yml up -d openape-troop   # 127.0.0.1:3010
          nginx-vhost UNVERÄNDERT → https://troop.openape.ai
          Health-Check :3010 → bei Fail: vorheriges Digest zurück + up -d (Rollback)
```

## Komponenten

1. **`apps/openape-troop/Dockerfile`** (NEU) — multi-stage nach Nest-Muster:
   - *Builder* (`node:22-bookworm-slim`, corepack pnpm, COPY Monorepo-Manifeste + Source, `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm --filter @openape/troop build` → `.output`).
   - *Runtime* (`node:22-bookworm-slim`, COPY `.output`, `ENV NITRO_PORT=3010 PORT=3010 HOST=0.0.0.0`, `EXPOSE 3010`, `CMD ["node", ".output/server/index.mjs"]`).
   - Nitro-Output ist self-contained → schlanke Runtime-Stage (kein `pnpm deploy`-Flatten wie beim Nest nötig; verifizieren, dass `.output/server` alle Runtime-Deps bündelt — sonst Nest-Muster `pnpm --filter @openape/troop deploy --legacy --prod` übernehmen).

2. **`compose/chatty.yml`** (NEU) — Service `openape-troop`:
   ```yaml
   services:
     openape-troop:
       image: ${REGISTRY:-ghcr.io/openape-ai}/openape-troop:${TROOP_TAG:-latest}
       container_name: openape-troop
       restart: unless-stopped
       ports: ["127.0.0.1:3010:3010"]
       env_file: [.env.troop]      # gitignored, auf chatty
       healthcheck:
         test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3010/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
         interval: 30s
         timeout: 5s
         retries: 3
   ```
   (Eine Datei, in die org/chat/free-idp später als weitere Services eingehängt werden.)

3. **`scripts/deploy-image.mjs`** (NEU) — generischer, parametrisierter Deployer (app, port, registry):
   - `buildx build --platform linux/arm64,linux/amd64 -t $REGISTRY/<app>:<gitsha> --push`
   - gepushtes **Digest** auflösen (`docker buildx imagetools inspect` oder push-Output) → in chatty's `.env.troop` als `TROOP_TAG` schreiben (digest-gepinnt, nicht `latest`).
   - SSH chatty: `docker compose -f compose/chatty.yml pull <svc> && up -d <svc>`
   - Health-Check auf `127.0.0.1:<port>` (HTTP 200).
   - **Rollback:** bei Health-Fail das vorherige Digest (aufgehoben, z.B. `TROOP_TAG_PREV` in `.env.troop`) zurücksetzen + `up -d`.
   - erbt von `deploy.mjs`: Change-Detection-Idee, `--dry-run`, `--list`. `REGISTRY` als Env (default `ghcr.io/openape-ai`).

4. **GHCR-Auth** (User-Setup, einmalig — siehe „Prerequisites"):
   - Mac: `docker login ghcr.io` mit PAT `write:packages`.
   - chatty: `docker login ghcr.io` mit PAT `read:packages` (im docker config des `openape`-Users).

5. **Cutover-Schritt** (troop): systemd `openape-troop.service` stoppen+disablen → `docker compose up -d openape-troop` → nginx unverändert → `https://troop.openape.ai` verifizieren. Unit dormant lassen.

## Reuse für Rollout (im Pilot zu faktorisieren)

- Das Dockerfile + die compose-Service-Definition sind so generisch wie möglich (Port/App-Name die einzigen Variablen) → org/chat/free-idp = Dockerfile kopieren (Port anpassen) + Service in `compose/chatty.yml` + `deploy-image.mjs <app>`.
- Ein optionales geteiltes Base-/Builder-Image (alle Nuxt-Apps teilen die Build-Schritte) ist eine Rollout-Optimierung, **nicht** Pilot-Pflicht (YAGNI bis ≥3 Apps).

## Akzeptanzkriterien (beobachtbar)

1. `docker buildx build --platform linux/arm64,linux/amd64 -t $REGISTRY/openape-troop:<sha> --push .` läuft durch; `docker buildx imagetools inspect` zeigt beide Plattformen.
2. **Lokal:** `docker compose -f compose/chatty.yml up openape-troop` → `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/` = `200`; die Agents-Liste rendert (Screenshot/curl).
3. **amd64-Smoke:** `docker run --rm --platform linux/amd64 -p 3010:3010 --env-file .env.troop $REGISTRY/openape-troop:<sha>` startet + Health 200 (QEMU).
4. **Prod-Cutover:** systemd-troop aus, Container an; `curl -s -o /dev/null -w '%{http_code}' https://troop.openape.ai/` = `200`; Agents-Liste lädt; `docker ps` zeigt `openape-troop` healthy.
5. **Rollback-Drill:** ein vorheriges Digest deployen → `troop.openape.ai` weiter 200 → zurück auf neu. Beweist die Rollback-Mechanik.
6. Kein Secret im Image: `docker history` / `docker inspect` zeigt keine Tokens; Env kommt nur aus `.env.troop`.

## Prerequisites (User-Aktion, brauchen Credentials/Zugriff — NICHT vom Agent machbar)

- **GitHub PAT(s)** erstellen: `write:packages` (Mac-Push), `read:packages` (chatty-Pull). `docker login ghcr.io` auf beiden Hosts.
- **GHCR-Sichtbarkeit:** sicherstellen dass das Org-Package `openape-troop` privat ist + chatty's PAT Lesezugriff hat.
- **`.env.troop` auf chatty** mit troops echten Env-Werten befüllen (aus dem aktuellen systemd-Unit / `apps/openape-troop`-Runtime-Config übernehmen): Turso-URL+Token, Management-Token, IdP-URL, etc.
- **chatty-Cutover** (systemd stop/disable + erster `compose up`) — der Agent kann den Prod-Deploy vorbereiten, aber der scharfe Cutover braucht dein Go (Prod-Aktion).

## Out of Scope

- org/chat/free-idp/docs-Cutover (Folge-Spec; Pilot-Pipeline + Templates machen ihn mechanisch).
- docs (static — bleibt nginx-static oder trivialer static-Container, Entscheidung beim Rollout).
- Self-hosted Registry (durch `REGISTRY`-Var offen gehalten; nicht jetzt).
- CI-gebaute Images (jetzt lokal gebaut „bei uns getestet"; die Pipeline ist CI-portabel, später optional).
- nest/llm-Pod (schon Docker; optional später auch nach GHCR statt lokalem `:dev` — separat).

## Risiken → Mitigation

- **Arch-Mismatch** → buildx multi-arch (Decision 2).
- **GHCR-Billing-Änderung** → `REGISTRY`-agnostisch (Decision 1).
- **Cutover bricht troop** → systemd-Unit dormant als Sofort-Fallback (Decision 5) + Health-Check + Rollback-Mechanik.
- **Secret-Leak** → `.env` gitignored auf chatty, nie ins Image (Decision 4; Akzeptanzkriterium 6).
- **Nitro-Output doch nicht self-contained** → Fallback auf Nest-Muster `pnpm deploy --legacy --prod` (Komponente 1, im Plan als Verzweigung).
- **Image-Bloat/Build-Zeit** → multi-stage + Layer-Cache; geteiltes Base-Image erst bei Rollout (≥3 Apps).
