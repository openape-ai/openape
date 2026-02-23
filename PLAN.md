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
idp_url = "https://id.example.org"
agent_key = "/etc/apes/agent.key"
agent_id = "mini-claw@example.org"
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

# Grant-gesteuert
[[grant_required]]
domain = "api.github.com"
methods = ["POST", "PUT", "DELETE", "PATCH"]
grant_type = "once"           # jeder Write braucht einzelne Genehmigung

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
{"ts":"2026-02-23T22:30:00Z","agent":"mini-claw@example.org","action":"allow","domain":"api.github.com","method":"GET","path":"/repos/x/issues","grant_id":null,"rule":"allow-list"}
{"ts":"2026-02-23T22:30:05Z","agent":"mini-claw@example.org","action":"grant_approved","domain":"api.github.com","method":"POST","path":"/repos/x/issues","grant_id":"abc123","rule":"grant_required","waited_ms":12000}
{"ts":"2026-02-23T22:30:10Z","agent":"mini-claw@example.org","action":"denied","domain":"169.254.169.254","method":"GET","path":"/latest/meta-data","grant_id":null,"rule":"deny-list"}
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

### Einschränkung: HTTPS CONNECT

Bei HTTPS sieht der Proxy nur:
- ✅ Domain (aus CONNECT)
- ❌ HTTP Method, Path, Body (verschlüsselt im Tunnel)

Für method/path-basierte Regeln bei HTTPS gibt es zwei Optionen:
1. **Domain-only Matching** (einfach, kein TLS-Aufbrechen) — reicht für 90% der Fälle
2. **mTLS Inspection** (komplex, eigene CA) — für strenge Umgebungen

**Empfehlung: Phase 1 nur Domain-Matching.** Method/Path-Matching als opt-in Phase 2 mit eigener CA.

## Phasen

### Phase 1 — MVP (2-3 Tage)
- [x] Proxy-Server (CONNECT + plain HTTP forward)
- [x] Agent-Auth (JWT Verification)
- [x] Config-Datei (TOML)
- [x] Deny/Allow-Liste (Domain-basiert)
- [x] Grant-Check gegen IdP API
- [x] Blocking Grant-Request (warte auf Approval)
- [x] Audit-Log (JSONL)
- [x] Graceful Shutdown

### Phase 2 — Production-Ready
- [ ] Connection Pooling
- [ ] Rate Limiting (pro Agent, pro Domain)
- [ ] Metrics (Prometheus)
- [ ] Health Endpoint
- [ ] Wildcard-Domains in Rules
- [ ] Grant-Caching (TTL-Grants lokal cachen)
- [ ] Systemd Service Unit
- [ ] Multiple Agent Support

### Phase 3 — Advanced
- [ ] mTLS Inspection (eigene CA, Method/Path Matching für HTTPS)
- [ ] WebSocket Support
- [ ] Dashboard UI (welcher Agent nutzt welche Domains)
- [ ] Integration mit `apes` (Proxy + sudo in einem Setup)
- [ ] Nuxt-Modul für Proxy-Management

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
| IdP (id.example.org) | Zentrale Autorität für Agents + Grants |

**Zusammen:** Ein Agent kann weder lokal (apes) noch im Web (proxy) etwas tun, ohne dass ein Mensch es erlaubt hat.
