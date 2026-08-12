# ape-kpi — errors

All API errors follow the RFC 7807 problem shape: `{ status, title, detail? }`.

| Status | Meaning | Fix |
|---|---|---|
| 400 | Validation failed (key/scope/value/unit/detail) | The title names the field and the rule |
| 401 | No valid session | `apes login <email>` once on this device |
| 403 | Delegated token lacks the `kpi:push` / `kpi:read` scope | Re-issue the delegation with the scope |
| 413 | Body too large | detail ≤ 64 KB |

Endpoint override for local dev: `APE_KPI_ENDPOINT=http://127.0.0.1:3022`.
