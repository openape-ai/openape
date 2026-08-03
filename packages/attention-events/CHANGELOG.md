# @openape/attention-events

## 0.1.0

- Initial release: envelope schema (ULID id, unix `ts`, DDISA `actor`, `actor_kind`, opaque `task_ref`, optional `goal_ref`/`org_id`) plus 12 v1 event types as a zod discriminated union; one fixture per type under `fixtures/`.
