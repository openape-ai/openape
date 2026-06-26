---
source: ape-tasks
team: 01KVQPYFPG11BCJHNEQBJJAY0G
lane: Ready
waiting_lane: Blocked
review_lane: Review
assignee: openape-loop@id.openape.ai
---

# auto-code task source — ape-tasks board (tasks.openape.ai)

The loop pulls tasks from the dedicated **"OpenApe Loop"** ape-tasks team: those in
the **Ready** lane assigned to `openape-loop@id.openape.ai`. Hand work to the loop
by assigning a task to that email and moving it into Ready. Escalations land in
**Blocked** (= the loop's "awaiting human" state). The loop never marks tasks done —
Patrick merges the PR and closes the task.

The frontmatter is the only machine-readable part. How tasks are read, moved, and
escalated is in `~/.claude/skills/auto-code/sources/ape-tasks.md`.

## Setup status (done)
- Team **"OpenApe Loop"** `01KVQPYFPG11BCJHNEQBJJAY0G` created; lanes Backlog · Ready · Doing · Review · Blocked · Done.
- Assignee `openape-loop@id.openape.ai` is a plain filter label (assignee needs no membership/login); the loop runs under Patrick's existing apes session, so its board moves are attributed to Patrick. A dedicated DDISA agent identity (own `apes login` → own attribution) is a later refinement — set `APE_TASKS_ASSIGNEE` + log in as that agent to switch.

## Starting the loop
Global `ape-tasks` is v1.3.0 (has the lane ops) and the server is live — no env needed:
```
cd ~/Companies/private/repos/openape/openape-monorepo
claude
# then: /loop /auto-code   (Sonnet session recommended, like iurio)
```
(`APE_TASKS_BIN` still overrides the CLI per session — only needed if a parallel agent runs from its own build.)

## Running agents in parallel
Each agent = its own apes/DDISA identity + its own loop session in this cwd, started with `APE_TASKS_ASSIGNEE=<its agent email>` (selects its Ready queue) and logged in as that agent. The poll keeps a separate `.auto-code/.state.<agent>.json` per agent automatically. Branch/worktree names carry the task id so paths never collide. Keep each session sequential.
