# LLM Pull-Queue — lokaler Claude-Worker für llms.openape.ai

**Datum:** 2026-06-24
**Status:** Spec approved, bereit für writing-plans

## Problem

Patrick will einen LLM-Worker auf seinem eigenen Mac laufen lassen und dessen
Kapazität remote über `llms.openape.ai` anbieten — ohne Port-Forwarding,
Firewall-Loch oder dauerhaft laufenden Dienst. Pull statt Push: Der Worker holt
sich Anfragen aktiv von der Queue.

Der Worker ist **Claude selbst** (eine Claude-Code-`/loop`-Session), nicht ein
separates lokales LLM. Manuell gestartet, wenn gebraucht; gestoppt, wenn nicht.

## Entscheidungen (aus Brainstorming)

| Frage | Entscheidung |
|-------|--------------|
| Worker | Claude Code `/loop` (kein separates LLM) |
| Betriebsmodus | Manuell via `/loop`, on-demand |
| Streaming | Nein — nur JSON-Responses |
| Client-Routing | Über Modellname `claude-local` |
| Worker-Auth | Statischer Shared Secret (`OPENAPE_QUEUE_TOKEN`) |

## Architektur

```
Client (Cursor/curl/Agent)
  │  POST /v1/chat/completions  { model: "claude-local", messages: [...] }
  ▼
llms.openape.ai  (Traefik edge)
  │  /v1     → litellm  (DDISA-Auth wie gehabt)
  │  /queue  → llm-queue (Shared-Secret-Auth, NEUER Router)
  ▼
litellm  (model_list: claude-local → http://llm-queue:4030/v1)
  ▼
llm-queue  (NEU: stdlib-Node-Service, Schwester von llm-route)
  │  ① Job in In-Memory-Map, Promise halten (long-poll bis Worker liefert)
  │  ② bei Result: Promise auflösen → OpenAI-JSON → litellm → Client
  ▲
  │  Worker-Pfad (extern, vom Mac):
dein Mac:  Claude Code  /loop
  GET  /queue/next        ← nächster Job (long-poll 25s, sonst 204)
  POST /queue/result/<id> ← Claudes Antwort zurück
```

**Kernidee:** Der Client-Pfad nutzt das bestehende DDISA-Auth + M3-Routing
unverändert. `claude-local` ist nur ein weiterer `model_list`-Eintrag, der
statt auf einen Upstream auf den Queue-Service zeigt. Der Worker-Pfad ist ein
separater Traefik-Router `/queue/*` mit Shared-Secret — die einzige nach außen
offene Fläche für den Mac.

## Komponenten

### 1. `llm-queue` Service (neu)

Winziger stdlib-Node-HTTP-Server (~120 Zeilen), gebaut und betrieben wie
`llm-route`. State: zwei In-Memory-Strukturen.

```
pending = Map<id, { body, resolve }>   // Jobs, die auf ein Result warten
waiting = Array<{ resolve }>           // Worker-Polls, die auf einen Job warten
```

| Endpunkt | Wer ruft auf | Auth | Verhalten |
|----------|--------------|------|-----------|
| `POST /v1/chat/completions` | litellm (intern, loopback) | keine | `id = randomUUID()`, `{body, resolve}` in `pending`, einen wartenden Worker-Poll wecken, `await` auf das Result-Promise, dann OpenAI-`chat.completion`-JSON zurück |
| `GET /queue/next` | Mac-Loop | Shared Secret | Falls Job vorhanden: `{id, messages}` sofort. Sonst in `waiting` einreihen, 25s warten → Job oder `204` |
| `POST /queue/result/<id>` | Mac-Loop | Shared Secret | `pending`-Promise auflösen mit `{content}`. Unbekannte `id` → `404` |

Kein DB, keine Persistenz, kein Retry — ponytail: ein Worker, manueller
On-Demand-Betrieb.

**Auth:** `Authorization: Bearer <OPENAPE_QUEUE_TOKEN>` auf `/queue/*`,
serverseitig per `crypto.timingSafeEqual` gegen die Env-Var geprüft. Der interne
`/v1`-Hop bleibt auth-frei (litellm hat den Client davor schon DDISA-geprüft,
das Netzwerk ist trusted loopback).

### 2. litellm-Eintrag (1 Zeile)

In `litellm-config-full.yaml`:

```yaml
- model_name: claude-local
  litellm_params: { model: openai/claude-local, api_base: http://llm-queue:4030/v1, api_key: queue-no-auth }
```

Fügt sich in `toggle-provider.py` ein — neuer Provider-Key `claude-local`
(Pattern: `llm-queue`), an-/abschaltbar wie `headwai`/`codex-dm`.

### 3. Traefik-Router (1 Block)

In `openape-services.yml`: `llms.openape.ai` + `PathPrefix(/queue)` →
`llm-queue:4030`. Der bestehende `/v1`-Router bleibt unverändert → litellm.
Router-Priorität: `/queue` spezifischer als `/v1`-Default, damit korrekt
gematcht wird.

### 4. Worker: Claude Code `/loop` (kein Code)

Ein Loop-Prompt auf dem Mac, der pro Iteration:
1. `GET https://llms.openape.ai/queue/next` mit dem Token-Header
2. Bei `204`: nichts tun, weiter pollen
3. Bei Job: `messages` lesen, Anfrage beantworten
4. `POST https://llms.openape.ai/queue/result/<id>` mit `{content}`

Die `/loop`-Skill paced sich selbst. Der Loop wird manuell gestartet und mit
"stop" beendet.

## Datenfluss (Happy Path)

1. Client → `POST /v1/chat/completions {model: "claude-local", messages}` →
   litellm (DDISA-geprüft) → `llm-queue`
2. `llm-queue`: `id = randomUUID()`, `{body, resolve}` in `pending`, weckt
   wartenden Worker-Poll, `await`et Promise
3. Mac-Loop: `GET /queue/next` → `{id, messages}`, Claude antwortet, `POST
   /queue/result/<id> {content}`
4. `llm-queue`: löst Promise auf, wrappt `content` in OpenAI-JSON, zurück an
   litellm → Client

## Fehlerbehandlung

| Fall | Verhalten |
|------|-----------|
| Kein Worker läuft | Job bleibt in `pending`, Client-Request läuft nach litellm-`timeout: 600s` in 504 — sauberes „niemand da" |
| Worker-Poll-Timeout (25s, kein Job) | `204`, Mac-Loop pollt sofort neu |
| Result für unbekannte/abgelaufene `id` | `404`, Worker verwirft |
| Client bricht ab, während Job wartet | Promise verworfen, späterer Result-POST → `404` (harmlos) |
| Shared Secret falsch/fehlt | `401` auf `/queue/*` |
| Zwei Worker pollen | Erster gewinnt (Map-`delete` atomar in Node single-thread); funktioniert, ist aber nicht der Use-Case |

## Selbst-Check (ponytail-Pflicht)

Ein `node --test`, das den Service in-process hochfährt:
1. `POST /v1/chat/completions` absetzen (nicht awaiten)
2. `GET /queue/next` → erwartet den Job mit `id` + `messages`
3. `POST /queue/result/<id>` mit Test-`content`
4. prüft, dass der `/v1`-Response korrektes OpenAI-`chat.completion`-JSON mit dem
   `content` enthält

Deckt die ganze Promise-/Long-poll-Mechanik ab.

## Bewusst weggelassen (YAGNI)

- **Persistenz** — In-Memory reicht; Worker-Neustart verliert nur in-flight Jobs
- **Streaming/SSE** — nur JSON-Responses
- **Mehrere Worker / Load-Balancing** — ein Worker
- **Retry-Logik** — Client kann selbst retryen
- **Auth auf dem internen `/v1`-Hop** — litellm-DDISA davor genügt

Alles nachrüstbar, wenn der manuelle On-Demand-Betrieb zu eng wird.

## Dateien (geschätzt)

| Datei | Art | Ort |
|-------|-----|-----|
| `apps/openape-llm-queue/` (server + Dockerfile + test) | neu | Monorepo |
| `litellm-config-full.yaml` | +1 Eintrag | chatty `/home/openape/prod-llms/` |
| `toggle-provider.py` | +1 Provider-Key | chatty (existiert) |
| `docker-compose.yml` | +1 Service | chatty `/home/openape/prod-llms/` |
| `openape-services.yml` | +1 Traefik-Router | chatty |
| `/loop`-Worker-Prompt | Doku/Snippet | irgendwo greifbar |
