# openape-proxy — Agent HTTP Gateway

## Übersicht

Ein HTTP-Forward-Proxy der den gesamten ausgehenden Traffic eines Agents kontrolliert. Agents haben keinen direkten Internet-Zugang — alles läuft durch den Proxy, der Grants prüft, Requests filtert und alles loggt.

## Architektur

```
┌─────────┐    HTTP_PROXY    ┌──────────────┐    HTTPS    ┌──────────┐
│  Agent   │ ──────────────→ │ openape-proxy │ ─────────→ │ Internet │
│          │                 │              │             │          │
│ (HTTP    │  ← 403 oder ─── │  • Auth      │             └──────────┘
│  Client) │    Grant-Request │  • Grants    │
└─────────┘                  │  • Audit     │
                             │  • Rules     │
                             └──────┬───────┘
                                    │ Grant-API
                                    ▼
                             ┌──────────────┐
                             │   IdP        │
                             │ (id.office.  │
                             │  or.at)      │
                             └──────────────┘
```

## Agent-Integration

Null-Config für den Agent:
```bash
export HTTP_PROXY=http://localhost:9090
export HTTPS_PROXY=http://localhost:9090
```

Jeder HTTP-Client (curl, fetch, axios, Python requests, etc.) respektiert diese Env-Vars automatisch.

## Authentifizierung

Agent identifiziert sich am Proxy via Proxy-Authorization Header:
```
CONNECT api.github.com:443 HTTP/1.1
Proxy-Authorization: Bearer <agent-jwt>
```

Das Agent-JWT kommt aus dem bestehenden Ed25519 Challenge-Response Flow.

## Grant-Matching

### Regel-Hierarchie

1. **Deny-List** — immer blockiert (z.B. interne Netzwerke, IdP selbst)
2. **Allow without Grant** — immer erlaubt (z.B. DNS, NTP)
3. **Standing Grants** — Agent hat `allow_always` für Domain+Method
4. **TTL Grants** — Agent hat zeitlich begrenzten Grant
5. **Prompt for Grant** — kein Grant vorhanden → Optionen:
   a. `block` — sofort 403
   b. `request` — Grant-Request erstellen, auf Approval warten (blocking)
   c. `request-async` — Grant-Request erstellen, sofort 403, Agent kann später retry

### Regel-Konfiguration

```toml
[proxy]
listen = "127.0.0.1:9090"
idp_url = "https://id.office.or.at"
agent_key = "/etc/apes/agent.key"
agent_id = "mini-claw@office.or.at"
default_action = "request"   # block | request | request-async
audit_log = "/var/log/openape-proxy/audit.jsonl"

# Immer erlaubt (kein Grant nötig)
[[allow]]
domain = "*.openape.at"

[[allow]]
domain = "api.github.com"
methods = ["GET"]

# Immer blockiert
[[deny]]
domain = "169.254.169.254"    # AWS metadata
note = "cloud metadata endpoint"

[[deny]]
domain = "*.internal"

# Grant-gesteuert (Domain + Method + Path)
[[grant_required]]
domain = "api.github.com"
path = "/repos/*/issues"
methods = ["POST"]
grant_type = "once"           # jeder neue Issue braucht Genehmigung

[[grant_required]]
domain = "api.github.com"
methods = ["PUT", "DELETE", "PATCH"]
grant_type = "once"           # alle anderen Writes auch

[[grant_required]]
domain = "api.openai.com"
grant_type = "always"         # Standing Grant, einmal genehmigen reicht

[[grant_required]]
domain = "*"                  # alles andere
grant_type = "once"
```

## Request-Lifecycle

```
1. Agent sendet CONNECT api.github.com:443
2. Proxy prüft Agent-JWT (Proxy-Authorization)
3. Proxy extrahiert: domain=api.github.com, method=POST, path=/repos/x/issues
4. Regel-Matching:
   a. In deny-list? → 403 Blocked
   b. In allow-list? → Tunnel aufbauen, weiterleiten
   c. Aktiver Grant vorhanden? → Tunnel aufbauen, weiterleiten
   d. Kein Grant → default_action ausführen:
      - "block": 403
      - "request": Grant-Request an IdP, warte auf Approval, dann weiterleiten
      - "request-async": Grant-Request erstellen, 407 Proxy Authentication Required
5. Audit-Log schreiben (JSONL)
```

## Audit-Log Format

```jsonl
{"ts":"2026-02-23T22:30:00Z","agent":"mini-claw@office.or.at","action":"allow","domain":"api.github.com","method":"GET","path":"/repos/x/issues","grant_id":null,"rule":"allow-list"}
{"ts":"2026-02-23T22:30:05Z","agent":"mini-claw@office.or.at","action":"grant_approved","domain":"api.github.com","method":"POST","path":"/repos/x/issues","grant_id":"abc123","rule":"grant_required","waited_ms":12000}
{"ts":"2026-02-23T22:30:10Z","agent":"mini-claw@office.or.at","action":"denied","domain":"169.254.169.254","method":"GET","path":"/latest/meta-data","grant_id":null,"rule":"deny-list"}
```

## Implementierung

### Sprache: Rust

- Wie `apes` — konsistent im Ökosystem
- Performant für Proxy-Workload (viele gleichzeitige Connections)
- `tokio` + `hyper` für async HTTP
- Kein TLS-Aufbrechen nötig: CONNECT-Tunnel ist opak (nur Domain sichtbar, nicht der Inhalt)

### Crates

- `hyper` — HTTP Server/Client
- `tokio` — Async Runtime
- `tokio-rustls` — TLS für Upstream-Verbindung zum IdP
- `serde` + `toml` — Config
- `tracing` — Structured Logging

### Proxy-Modus: Application-Level (nicht CONNECT-Tunnel)

Ein klassischer HTTPS CONNECT-Tunnel sieht nur die Domain — Method, Path und Body sind verschlüsselt. Das reicht nicht für granulare Kontrolle.

Stattdessen: **Application-Level Forward Proxy**. Der Agent schickt den Request unverschlüsselt an den lokalen Proxy, der Proxy macht den HTTPS-Call zum Ziel:

```
Agent ──HTTP──→ openape-proxy ──HTTPS──→ api.github.com
  (lokal, plaintext)    (sieht alles)     (TLS zum Internet)
```

**Was der Proxy sieht:**
- ✅ Domain
- ✅ HTTP Method (GET, POST, DELETE, ...)
- ✅ Full Path (`/repos/x/issues`)
- ✅ Headers
- ✅ Body (kann `cmd_hash` darüber bilden!)

**Sicherheit:** Die unverschlüsselte Strecke Agent → Proxy ist `localhost` — gleiche Maschine, kein Netzwerk. Kein Risiko.

**Kompatibilität:** Standard `HTTP_PROXY` Env-Var funktioniert — jeder HTTP-Client schickt den vollen Request an den Proxy wenn die Ziel-URL HTTPS ist und `HTTP_PROXY` gesetzt ist.

Damit können Rules auf **Domain + Method + Path-Pattern** matchen:

```toml
[[grant_required]]
domain = "api.github.com"
path = "/repos/*/issues"
methods = ["POST"]
grant_type = "once"           # jeder neue Issue braucht Approval

[[allow]]
domain = "api.github.com"
path = "/repos/*/issues"
methods = ["GET"]             # Issues lesen immer erlaubt
```

## Phasen

### Phase 1 — MVP (1-2 Tage)
Ziel: Ein Agent kann nur ins Internet wenn ein Mensch es erlaubt hat.

- [ ] Application-Level Forward Proxy (TypeScript/Bun)
- [ ] HTTP + HTTPS Forwarding (Proxy macht TLS zum Ziel)
- [ ] WebSocket + SSE Support (Grant-Check beim Aufbau, dann Tunnel)
- [ ] Agent-Auth (JWT Verification via Proxy-Authorization)
- [ ] Config-Datei (TOML oder JSON)
- [ ] Deny/Allow/Grant-Required Regeln (Domain + Method + Path-Pattern)
- [ ] Grant-Check gegen IdP API (`@openape/grants` direkt importiert)
- [ ] Blocking Grant-Request (warte auf Approval)
- [ ] Audit-Log (JSONL)

### Phase 2 — Multi-Agent & Caching (1-2 Tage)
Ziel: Produktionsreif für mehrere Agents auf einem Server.

- [ ] Multiple Agent Support (verschiedene Keys, verschiedene Regeln)
- [ ] Per-Agent Config Profiles
- [ ] Grant-Caching (Standing Grants + TTL-Grants lokal cachen, kein IdP-Call pro Request)
- [ ] Connection Pooling (Keep-Alive zu häufig genutzten Upstreams)
- [ ] Wildcard-Domains + Glob-Patterns in Rules (`*.github.com`, `/repos/*/issues`)
- [ ] Graceful Shutdown + Auto-Restart
- [ ] Health Endpoint (`/healthz`)
- [ ] Systemd / launchd Service Unit

### Phase 3 — Observability & Compliance (1-2 Tage)
Ziel: Volle Transparenz über Agent-Aktivität im Web.

- [ ] Dashboard UI (Nuxt-App oder in IdP integriert)
  - Welcher Agent nutzt welche Domains
  - Traffic-Volumen pro Agent/Domain
  - Grant-Nutzung (wie oft, wann, welche)
  - Blocked Requests (was wurde verweigert)
- [ ] Request/Response-Logging (opt-in, für Audit/Compliance)
- [ ] Body-Hashing (`cmd_hash` über Request-Body für exakte Bindung)
- [ ] Metrics-Export (Prometheus/OpenTelemetry)
- [ ] Rate Limiting (pro Agent, pro Domain — Schutz vor Runaway-Agents)
- [ ] Alerting (Webhook/Telegram wenn Agent ungewöhnlich viele Requests macht)

### Phase 4 — Ecosystem-Integration
Ziel: Nahtlose Einbindung in OpenApe und Agent-Runtimes.

- [ ] `@openape/proxy` npm Package (programmatisch starten/konfigurieren)
- [ ] Integration mit `apes` (ein Setup: Proxy + sudo gemeinsam konfiguriert)
- [ ] OpenClaw Plugin (Proxy automatisch starten wenn Agent startet)
- [ ] Agent-Runtime SDKs (Python, Go) — für Agents die nicht auf HTTP_PROXY setzen
- [ ] Auto-Discovery (Agent fragt IdP: "Welche Domains darf ich?" → Config generieren)
- [ ] Temporary Bypass Token (Admin kann zeitlich begrenzten "Proxy-Skip" geben für Debugging)

## CLI

```bash
# Starten
openape-proxy --config /etc/openape-proxy/config.toml

# Test-Modus (loggt nur, blockiert nicht)
openape-proxy --config config.toml --dry-run

# Status
openape-proxy --status
```

## Zusammenspiel mit dem Ökosystem

| Komponente | Rolle |
|---|---|
| `openape-proxy` | Kontrolliert ausgehenden Agent-Traffic |
| `apes` (openape-sudo) | Kontrolliert lokale Privilege Elevation |
| `@openape/grants` | Grant-Logik (shared zwischen Proxy und sudo) |
| `@openape/nuxt-grants` | Web-UI für Grant-Approval |
| IdP (id.office.or.at) | Zentrale Autorität für Agents + Grants |

**Zusammen:** Ein Agent kann weder lokal (apes) noch im Web (proxy) etwas tun, ohne dass ein Mensch es erlaubt hat.
