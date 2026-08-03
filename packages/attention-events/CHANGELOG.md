# @openape/attention-events

## 0.2.0

- `decision.requested` and `work.blocked` accept optional `deadline` (unix seconds) and `on_timeout` (`recommendation` | `fail`), so a request declares what holds when nobody answers. Additive — v0.1 events stay valid.

## 0.1.0

- Initial release: envelope schema (ULID id, unix `ts`, DDISA `actor`, `actor_kind`, opaque `task_ref`, optional `goal_ref`/`org_id`) plus 12 v1 event types as a zod discriminated union; one fixture per type under `fixtures/`.
