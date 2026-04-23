---
'@openape/nuxt-auth-idp': minor
'@openape/core': patch
---

YOLO-Modus: per-Agent Opt-in Auto-Approval für Grant-Requests.

- Neuer Abschnitt auf `/agents/:email` zum (De)Aktivieren plus Deny-Patterns (Glob: `*`/`?`) und optionale Risiko-Schwelle.
- Admin-API: `GET|PUT|DELETE /api/users/:email/yolo-policy` (Session-Auth + Owner/Approver/Admin-Check).
- Server-seitige Auto-Approval läuft nach dem Standing-Grant-Match; zuerst erfolgreicher Matcher gewinnt. Deny-Patterns und Risk-Threshold (Shape-Resolver, generic fallback → `risk='high'`) rollen den Request auf den normalen manuellen Flow zurück.
- Audit-Marker: neue Spalte `grants.auto_approval_kind` (`'standing' | 'yolo' | null`). Grants-UI zeigt die Herkunft als Badge.
- Agent + CLI-Consumer (apes, grants, escapes) unverändert. JWT-Shape bleibt identisch zu human-approved Grants; nur der Datenbank-Eintrag markiert den Auto-Pfad.
- `OpenApeGrant.auto_approval_kind` als optionales Feld im Core-Typ ergänzt.
