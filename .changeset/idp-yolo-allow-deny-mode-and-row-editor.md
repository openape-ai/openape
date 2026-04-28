---
"openape-free-idp": minor
---

idp: YOLO mode toggle (allow/deny) + per-row pattern editor + Method+URL shape

Two structural changes to the YOLO model and a UI overhaul.

### `mode: 'allow-list' | 'deny-list'`

YOLO was always a single semantic: "auto-approve unless deny pattern matches".
That works for blocklist-style policies but not for the inverse — "auto-approve
ONLY for these specific things" — which is the right shape for tight Web/Root
profiles where the operator wants to enumerate the safe set.

Adds a `mode` column to `yolo_policies` (default `'deny-list'`,
backwards-compatible). The evaluator branches on it:

- **deny-list (legacy):** auto-approve UNLESS a pattern matches; risk
  threshold also applies.
- **allow-list (new):** require manual approval UNLESS a pattern matches.
  Risk threshold is a no-op (operator already enumerated the safe set).

Migration runs in `06.yolo-hook.ts` via idempotent `ALTER TABLE ADD COLUMN`.

### Per-row pattern editor

Replaces the multi-line textarea with one row per pattern + add/remove
buttons. Per-bucket shape:

- **Web:** `[Method ▼: ALL | GET | POST | PUT | …] [URL/Host glob] [🗑]`
- **Commands / Root / Default:** `[Pattern field] [🗑]`

Storage stays as a string array. Web rows serialize as `"<METHOD> <URL>"`
when method ≠ `*`, or just `"<URL>"` when method = `*` so today's
host-only matcher still fires for `ALL`-method rows. Method-specific rows
are stored forward-compatibly for the upcoming proxy-side method+path
enrichment (M3.5).

### Honest "Web enforcement" notice

Replaces the aspirational "in Arbeit" text with a concrete description of
today's enforcement coverage: ALL-method rows match host globs at CONNECT
time; method-specific rows are stored but only fire once M3.5 ships
proxy-side method+path enrichment.

### "Dauer" → "YOLO-Timer"

Field rename per Patrick's spec. Same semantics (expiry timestamp).

### Tests

61/61 pass, including 4 new tests for allow-list mode (no patterns →
null; matching pattern → approve; non-matching → null; risk threshold
ignored in allow mode).
