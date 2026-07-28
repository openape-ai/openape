# Queue Durability — Plan

> Approved sketch. Persist only in-flight task INPUTS; rehydrate on boot; delete on
> terminal. No progress persistence, no full-DB rewrite. Fixes: proactive tasks
> (trigger/hook fires) silently dropped on a troop restart.

## Pieces
- `cockpit_tasks` table (schema.ts + idempotent DDL): id, owner_email, org_id,
  system_prompt, user_message, created_at. Holds only unfinished tasks.
- `queue.ts` + `restoreTask(t)` — in-memory insert with a GIVEN id (pure, testable).
- `task-store.ts` (new) — `saveTask`, `removeTask`, `loadAndPrunePending(maxAgeMs)`.
- enqueue call sites (`message.post`, `fire.ts`) — `void saveTask({...})` after enqueue.
- resolve handler (`agent/tasks/resolve.post.ts`) — `void removeTask(id)` on terminal.
- `server/plugins/04.rehydrate-queue.ts` — on boot, loadAndPrune → restoreTask each.

## Ceilings (ponytail)
- Orphan self-heals in ≤1 cycle: if `removeTask` races ahead of `saveTask` (worker
  resolves in the µs before the INSERT), the row re-runs once on next boot, then its
  terminal resolve deletes it. Rare + benign duplicate — same idempotency ceiling.
- Stale rows (>maxAge, worker never ran) pruned on rehydrate.

## Acceptance
Seed a `fireAt=now+30s` trigger → restart troop mid-flight (before the worker claims)
→ after boot the task is rehydrated, the worker runs it, the message lands. Today:
silently lost.
