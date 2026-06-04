# Linux-only Agent-Spawn — Design

**Datum:** 2026-06-04
**Status:** Freigegeben (Design)
**Auslöser:** Agent-Anlage über die Troop-UI schlägt fehl: `CliError: \`apes agents spawn\` is currently macOS-only. Detected platform: linux.` — der Docker/Linux-Nest kann keine Agents spawnen, also ist die Kern-Funktion von Troop auf der Deploy-Plattform kaputt.

## Befund / Ehrliche Retrospektive

- **Topologie:** Troop (chatty) spawnt nicht selbst — es dispatcht eine `spawn-intent` über `nest-ws` an den Nest; der **Nest** führt `apes agents spawn` lokal aus. Der fehlschlagende Nest ist Linux (Docker-`openape-nest`-Container).
- **Die Mac→Docker-Migration (M2) war unfertig:** der Cutover entfernte Mac-Pfade/launchd-Refs + den dualen Chat-Backend, aber `apes agents spawn` selbst blieb hinter einem `isDarwin()`-Guard (Zeile 91) macOS-only. Der MIGRATION-Tracker zählte das spawn-Command nicht auf. Verifiziert wurden Deploy + Nest-Reconnect — **nicht** der Kern-Flow „Agent spawnen auf Linux".
- **Test-Lücke:** das Contract-Netz deckt das Protokoll ab, nicht den Platform-/Spawn-Pfad. Ein „spawn auf Linux"-Test hätte das gefangen.

## Entscheidung: Linux-only

Statt Linux-Spawn *neben* macOS zu implementieren (doppelte Plattform-Pflege), **den macOS-nativen Agent-Execution-Pfad ganz entfernen**. Nests sind immer Linux (Docker-Container, auch auf Mac-Hosts via Docker). Begründung: vollendet das Docker-first-Re-Framing, eine Plattform = drastisch weniger Wartung + ein Pfad, der wirklich getestet wird.

**Implikation:** keine macOS-native Agent-Ausführung mehr. `mbp-home` (der aktuelle Mac-Nest) läuft künftig einen Docker/Linux-Nest-Container statt nativer macOS-User. (Migration des Nests = separater Betriebsschritt, nicht Teil dieses Specs.)

## Schlüsselfund, der das vereinfacht

Der Nest hat bereits einen **plattform-agnostischen `Pm2Supervisor`** (`apps/openape-nest/src/lib/pm2-supervisor.ts`): er reconciled die Agent-Registry → supervised pro Agent **einen `ape-agent`-Prozess via pm2** (nicht launchd). Das gewählte Supervision-Modell **existiert also schon**. Auch `spawn.ts` baut bereits ein privilegiertes User-Script und führt es via `platform.runPrivilegedBash(script)` aus (Z.266). Die macOS-only-Lücke ist eng: das Script ist **dscl-codiert**, der `isDarwin()`-Guard blockt davor, und es werden **launchd-Plists** installiert (auf Linux unnötig — pm2 + der Nest-eigene `troop-sync.ts` übernehmen das).

## Architektur

**Linux-Spawn-Flow (`apes agents spawn` auf dem Nest):**
1. `isDarwin()`-Guard entfernen.
2. Agent-OS-User anlegen: das privilegierte Script wird **Linux (`useradd`/`getent`/home-dir + chown)** statt dscl — gebaut für den Linux-Pfad, ausgeführt über das bestehende `host-platform.runPrivilegedBash(script)`. Der `linux-user`-Helper (`readLinuxUser`/`listLinuxUserNames`) deckt die Reads ab; der Create-Script ist die zu ergänzende Schreib-Seite.
3. **Keine launchd-Plists** mehr installieren. Der Nest-`Pm2Supervisor` zieht den neuen Registry-Eintrag beim nächsten `reconcile()` hoch (eine `ape-agent`-Prozess-Supervision pro Agent, laufend als der Agent-User). Troop-Sync läuft Nest-zentral (`troop-sync.ts`), nicht per-Agent.
4. `whichBinary`/`isShellRegistered` (macos-user): durch Linux-Äquivalente ersetzen oder droppen (Login-Shell-Registrierung ist auf Linux via `useradd -s` direkt; Binary-Lookup über `which`/PATH).

**`host-platform/` kollabiert auf Linux:** die `darwin-*`-Impls + die Plattform-Verzweigung entfallen; ein dünner `HostPlatform`-Seam bleibt (für Testbarkeit + den Fall künftiger Plattformen), implementiert nur noch Linux.

## Rip-out (macOS-nativ raus)

Entfernen: `packages/apes/src/lib/macos-user.ts`, `launchd-reconcile.ts`, `macos-host.ts`, die `buildSyncPlist`/`buildBridgePlist`-launchd-Builder in `troop-bootstrap.ts`, die `host-platform/darwin*.ts`-Impls. Die `isDarwin()`/macOS-only-Branches (16 Vorkommen) in `commands/agents/{spawn,destroy,allow,list,cleanup-orphans}.ts` + `commands/{run,enroll,auth/login}.ts` auflösen (Linux-Pfad als einziger). `cleanup-orphans` (macOS-dscl-Tombstones) entweder Linux-äquivalent (orphan useradd-User) oder entfernen, falls Linux kein Tombstone-Konzept braucht.

## Tests (schließt die Lücke)

- **Unit:** Linux-User-Create-Script-Generierung (useradd/home/chown korrekt, Name-Sanitisierung), Registry-Write nach Spawn, der `host-platform` Linux-Pfad (readLinuxUser/listLinuxUserNames + runPrivilegedBash-Script-Shape). Mirror der bestehenden apes-Testpatterns.
- **Regression:** bestehende Nest/pm2-Supervisor-Tests bleiben grün.

## E2E-Verifikation (schließt Punkt 1 — diesmal wirklich)

Agent end-to-end auf dem **echten Linux-Docker-Nest** spawnen: Troop-UI „Anlegen" → spawn-intent → Nest `apes agents spawn` → useradd-User entsteht → pm2 supervised den `ape-agent`-Prozess → Agent erscheint als aktiv. Das ist der Beweis, der bei M2 fehlte. **Braucht die Nest-Umgebung** (chatty/Container); der Prod-Spawn-Trigger liegt beim Owner (Agent kann ihn nicht selbst auslösen).

## Nicht im Scope

- „Ein-Agent-ein-Pod"-Modell (verworfen — Nest-supervised-Prozesse + useradd gewählt).
- Migration des `mbp-home`-Nests von macOS-nativ auf Docker (Betriebsschritt).
- apes-CLI-Kern (`commands/`/`shell/`) — bleibt.
