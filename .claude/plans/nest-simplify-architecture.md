# Plan: Nest-Architektur-Vereinfachung (4 Phasen)

> Self-contained.

## Purpose / Big Picture

Die heutige 3-Tier-Architektur (Nest + per-Agent Bridge-Plist + per-Turn Runtime + per-Agent Troop-Sync-Plist + Cron-Plists) hat zu viele bewegliche Teile. Ergebnis: ~5 launchd-Plists pro Agent, separate Code-Pfade für jede Schicht, und ein lokaler HTTP-Server am Nest dessen DDISA-Gating wir extra implementieren mussten.

Patrick's Vereinfachung: Nest ist der EINZIGE system-supervised Prozess. Innerhalb des Nest werden per-Agent Long-Running-Runtimes (LRR) als pm2-Children gehalten. Der Nest selbst macht troop-sync für alle Agents zentral. Spawn-Intent kommt nicht mehr über localhost-HTTP sondern über IdP-Grants.

- **Ziel**: 1 launchd-Plist gesamt (für pm2). Pro Agent 0 Plists, 1 LRR-Prozess. Kein Nest-HTTP-Server mehr. Spawn via DDISA-Grant-Polling.
- **Scope**: 4 Phasen, jede für sich stand-alone shipbar.

## Phasen

### Phase A — Bridge + Runtime mergen zu LRR

**Heute**: `apps/openape-chat-bridge/src/bridge.ts` öffnet WebSocket zu chat.openape.ai. Pro eingehende Message spawnt `ApesRpcSession` einen `apes agents serve --rpc` child-process via stdio JSON-RPC.

**Danach**: Bridge importiert die runtime-Logic direkt als Funktionen statt JSON-RPC. Eine Prozess pro Agent erledigt beides.

**Dateien**:
- `apps/openape-chat-bridge/src/bridge.ts` — entferne ApesRpcSession-Spawn
- `apps/openape-chat-bridge/src/apes-rpc.ts` — Body in einen direkten Call refaktorieren
- `packages/apes/src/commands/agents/serve.ts` — die Runtime-Logic in eine importierbare Funktion extrahieren

**Akzeptanz**: `apes nest spawn igorN`, dann Ping per Chat. Bridge antwortet ohne Sub-Prozess-Spawn (verifiziert via `ps aux | grep "apes agents serve"` während chat-turn läuft → 0 Prozesse).

### Phase B — pm2 als Nest-internen Supervisor

**Heute**: `apes agents spawn --bridge` installiert `/Library/LaunchDaemons/eco.hofmann.apes.bridge.<agent>.plist`.

**Danach**: Spawn registriert agent stattdessen beim Nest's pm2-Prozess. Nest startet via 1 launchd-Plist + `pm2 startup` Auto-Resurrection.

**Dateien**:
- `apps/openape-nest/src/lib/pm2.ts` — NEU: Wrapper um pm2-API (`spawnLrr`, `stopLrr`, `listLrrs`)
- `apps/openape-nest/src/index.ts` — pm2-Init bei Daemon-Start, reconcile auf registry
- `packages/apes/src/lib/agent-bootstrap.ts` — `bridge.plistContent`-Block entfernen, neue Variante: Nest-API-Call zum LRR-Register
- `packages/apes/src/commands/nest/install.ts` — `pm2 startup` integrieren

**Akzeptanz**: Reboot. Nach login: pm2 ist up, alle LRRs laufen, KEIN system-domain Bridge-Plist im `/Library/LaunchDaemons/` mehr.

### Phase C — Troop-Sync zentralisieren im Nest

**Heute**: Pro Agent ein launchd-Plist `openape.troop.sync.<agent>.plist` der alle 5min `apes agents sync` aufruft.

**Danach**: Nest hat einen Sync-Loop (oder WebSocket zu troop) der für alle registrierten Agents die Sync-Requests batcht.

**Dateien**:
- `apps/openape-nest/src/lib/troop-sync.ts` — NEU: zentraler Sync-Loop, reading-Liste aus registry
- `packages/apes/src/lib/troop-bootstrap.ts` — `buildSyncPlist` deprecaten, durch Nest-Registration ersetzen
- `packages/apes/src/commands/agents/spawn.ts` — keine troop-sync Plist mehr installieren

**Akzeptanz**: `ls /Library/LaunchDaemons/ | grep openape.troop.sync` ist leer. Trotzdem zeigt troop.openape.ai alle Agents als "online".

### Phase D — Spawn-Intent via Grant-Polling

**Heute**: `apes nest spawn igorN` POSTs an localhost:9091.

**Danach**: `apes nest spawn igorN` erzeugt DDISA-Grant `command: ['nest','spawn',name]`. Nest pollt regelmäßig die approved-grants für sich selbst und führt aus. HTTP-Server raus.

**Dateien**:
- `apps/openape-nest/src/lib/intent-poller.ts` — NEU: Poll-Loop am IdP für eigene Grants, dedupes-via grant-id
- `apps/openape-nest/src/index.ts` — HTTP-Server raus, Poll-Loop rein
- `apps/openape-nest/src/lib/auth.ts` — Bearer-Verify-Code raus
- `packages/apes/src/lib/nest-grant-flow.ts` — `requestNestGrant` returnt nur den Grant-ID statt Token (kein HTTP-call mehr)
- `packages/apes/src/commands/nest/spawn.ts` etc. — kein HTTP-call mehr, nur Grant + warten auf grant.status='used'
- `apps/openape-nest/tests/auth-negative.sh` — obsolet, wird gelöscht

**Akzeptanz**: `apes nest spawn igorN` funktioniert ohne HTTP-Server (`lsof -i :9091` ist leer). Spawn-Latenz ~5-30s (Poll-Intervall + Spawn).

## Progress

- [ ] `[2026-05-10 …]` Plan
- [ ] Phase A: Bridge ⊕ Runtime
- [ ] Phase B: pm2
- [ ] Phase C: zentraler troop-sync
- [ ] Phase D: Grant-Polling Intent

## Decision Log

| Datum | Entscheidung | Grund |
|---|---|---|
| 2026-05-10 | pm2 statt eigenem Supervisor | log-rotation, list-API, Reload — alles geschenkt; einzige Kosten: Node-Dep |
| 2026-05-10 | Bridge + Runtime mergen, nicht parallel halten | Single-Source-of-Truth, kein RPC-stdio |
| 2026-05-10 | Spawn-Intent über Grant-Polling, nicht troop-WebSocket | weniger Server-side-Code, gleiche Latenz |
| 2026-05-10 | Phase D zuletzt | bringt UX-Latenz; soll erst kommen wenn andere Vereinfachungen Wert geliefert haben |
