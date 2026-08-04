# @openape/attention-events

## 0.4.0

- The OpenApe word for a decision waiting on a human is a **call**: an agent *raises* one, a human *answers* it. New `call.raised` (with `kind`: decision | escalation | verdict) and `call.answered`. The three older request types and their answers stay valid — every reader folds both vocabularies, and 50+ recorded events depend on them.

## 0.3.0

- Request cards carry their own briefing: optional `title` + `summary` on `decision.requested`, `work.blocked` and `verdict.requested`; `option_summaries` (one line per option) and `recommendation_why` on the decision types; `highlights` plus a recommended `recommendation`/`recommendation_why` on review cards. A card now explains itself before AND after the decision. Additive — v0.1/v0.2 events stay valid.

## 0.2.0

- `decision.requested` and `work.blocked` accept optional `deadline` (unix seconds) and `on_timeout` (`recommendation` | `fail`), so a request declares what holds when nobody answers. Additive — v0.1 events stay valid.

## 0.1.0

- Initial release: envelope schema (ULID id, unix `ts`, DDISA `actor`, `actor_kind`, opaque `task_ref`, optional `goal_ref`/`org_id`) plus 12 v1 event types as a zod discriminated union; one fixture per type under `fixtures/`.
