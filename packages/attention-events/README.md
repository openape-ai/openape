# @openape/attention-events

Append-only event vocabulary for the attention queue (plan `01KZ3QPW5EC0JRXN5TB60R54TQ` on plans.openape.ai). Events describe the human-decision lifecycle of a task — spec, work, decisions, proofs, verdicts, cost, shipping — so inbox, metrics, and track records can be projected from them.

`task_ref` is deliberately an opaque string (`ape-tasks:<id>`, `ape-plans:<id>`, …): the event layer never couples to a task store.

```ts
import { parseAttentionEvent } from '@openape/attention-events'

const event = parseAttentionEvent(body) // throws on schema violation
```

One example event per type lives in `fixtures/` — consumers (e.g. troop's ingest API tests) reuse them.
