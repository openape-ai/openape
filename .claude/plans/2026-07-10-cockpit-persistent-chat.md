# Cockpit: persistente, verbindungs-unabhängige Konversation

**Goal:** Der Cockpit-Chat hängt nicht mehr an der Live-Verbindung. Nachricht UND Antwort werden
serverseitig gespeichert; SSE ist nur ein Live-Overlay. Weggehen & wiederkommen → alles da.

**Architektur:** Source of Truth = `cockpit_chat_messages` (pro owner+org). Senden persistiert die
User-Nachricht + enqueued; der CEO-Resolve persistiert die Antwort — beides unabhängig davon, ob eine
SSE-Verbindung offen ist. Der Client lädt die Konversation vom Server; SSE streamt live, bei Abriss
Reconnect + Poll-Fallback auf `GET /messages?since=`.

## M1 — Persistenz serverseitig (Grundlage)
- `cockpit_chat_messages` Tabelle + Boot. `chat-store.ts` (saveChatMessage/loadChat).
- `message.post`: User-Nachricht ZUERST persistieren, dann enqueue+stream.
- `agent/tasks/resolve.post`: bei `completed` die Antwort persistieren (task.company/owner via getTask).
- `GET /api/cockpit/messages?company=X[&since=ts]`: die Konversation.
- **Acceptance:** Nachricht senden → resolven OHNE Client → `GET /messages` zeigt User+Antwort.

## M2 — Client: vom Server laden + Reconnect/Poll
- useCockpitChat lädt aus `GET /messages` (statt nur IndexedDB); SSE als Overlay; bei Abriss 1× reconnect,
  dann Poll `GET /messages?since=` bis die Antwort da ist.
- **Acceptance:** Tab schließen/öffnen → Antwort, die währenddessen kam, ist da. SSE mitten drin killen →
  Antwort erscheint trotzdem.

## M3 — Längere Poll-Zeit + Transparenz
- Idle-Intervall darf hoch. message.post sagt bei schlafendem CEO klar: „💤 aufgenommen, wird beim
  Aufwachen (~Ns) beantwortet". Persistiert+queued → Tab zu, Antwort kommt+bleibt.
- **Acceptance:** langes Idle → Nachricht → „aufgenommen" → Tab zu → CEO wacht auf+antwortet → auf
  Rückkehr da.
