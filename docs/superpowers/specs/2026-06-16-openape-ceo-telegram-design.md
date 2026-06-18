# OpenApe CEO in Telegram + team visibility — Design

**Date:** 2026-06-16 · **Owner:** Patrick (patrick@hofmann.eco) · **Status:** approved (design)

## Problem

Patrick has ~18 agents working on OpenApe but no visibility into what the team
does, and no working CEO he can talk to. The existing `ceo` agent is hollow:

- runs with `tools=[none]` → it cannot run `ape-tasks`, read git, or curl anything;
- its operating protocol still targets `org.openape.ai`, which was shut down in
  the org→troop merge;
- it is not on a schedule, so it does nothing autonomously.

Delta Mind already has a working CEO reachable on Telegram (`dm-ceo` via
`t.me/delta_mind_ceo_bot`). We want the same for OpenApe.

## Decisions (Patrick, 2026-06-16)

- **Approach A**: repair the existing `ceo` agent (don't spawn a new one).
- **Visibility = both** pull (ask) and push (daily standup).
- **CEO role = status + light steering**: primarily Patrick's window into the
  team; can also accept directives that turn into tasks/objectives. Execution
  stays with the team (pm-orchestrator / personas).
- **Data sources now = tasks + PRs + troop company** (objectives/reports/costs),
  which requires agent-read-auth on troop.
- **Standup = daily 08:00 Europe/Vienna** to Telegram.
- **Telegram bot = new** (Patrick creates via @BotFather, supplies the token).

The `ceo` agent maps to troop company **"OpenApe Werkstatt"**, org id
`38f8e8e9-eec5-440c-b716-6c0f8224270c`. (Delta Mind = `5fa4cb85…`.)

## Components

### 1. Troop agent-read-auth (`apps/openape-troop`)
The org sub-resource GETs are owner-only today: `api/orgs/[id]/index.get`,
`members`, `objectives`, `reports`, `cost-snapshots`. Change the **GET** handlers
to also accept a **caller agent owned by the org owner** (read-only); all
writes (`patch`/`delete`/objective+report creation) stay owner-only.

Authorization rule (read): allow if caller is the org owner, OR caller is an
agent (`act=agent`) whose derived owner (`parseAgentEmail(sub).ownerEmail` from
`@openape/core`) equals the org's `owner`. This reuses existing identity logic,
needs no new membership lookup, and is correct for the single-owner case. (A
stricter per-member rule can come later for multi-tenant.)

This unblocks the CEO now and the 35 stale catalog recipes (org→troop) later.

### 2. CEO recipe repair (`agent-catalog/ceo/ape-agent.yaml`)
- **Tools (correct runtime names):** `tasks.list`, `tasks.create`, `http.get`,
  `forge.pr.status`, `forge.issue.get`, `time.now`. (The recipes' old `http`/
  `file`/`time` names are invalid — that is the same bug that bricks `cfo`.)
- **Repoint** all `org.openape.ai/api/orgs/{{org_id}}…` reads to
  `https://troop.openape.ai/api/orgs/38f8e8e9…/{objectives,reports,members,cost-snapshots}`
  via `http.get`.
- **Protocol rewrite — status + light steering:**
  - On an owner message: produce a live status — team tasks grouped by assignee
    (open/doing), blockers (tasks handed back to owner), recent PRs
    (`forge.pr.status`), and current objectives. Numbers + links over prose.
  - On an owner directive ("focus on X"): `tasks.create` assigned to
    pm-orchestrator / the right persona; note an objective on the troop company
    when objective-write-auth exists (until then, tasks only).
  - Keep the existing guardrails (stateless, high-risk → owner, stay in lane).

### 3. Telegram channel for `ceo`
The bridge turns the adapter on when `TELEGRAM_BOT_TOKEN` is present in its env
(`bridge-config.ts`), with trust-on-first-use owner pinning
(`telegram-owner.json`). Steps: Patrick creates a bot via @BotFather → its token
is provisioned into the `ceo` bridge env the same way `dm-ceo`'s is (per-agent
secret + supervisor env-forward list — mirror the existing dm-ceo wiring) →
restart the `ceo` bridge → Patrick DMs the bot once to pin himself as owner.

### 4. Daily standup push
A recurring task (cron-runner) fires **daily 08:00 Europe/Vienna**, runs the
same status compilation as the pull path, and posts it as an owner DM — which is
mirrored to Telegram by the channel from component 3.

## Data flow

- **Pull:** Patrick → Telegram bot → `TelegramChannel` → bridge → `runLoop`
  (CEO persona + tools read tasks.list / forge / troop org) → reply → Telegram.
- **Push:** cron (daily 08:00) → standup task → CEO compiles digest → owner DM →
  Telegram.

## Out of scope / follow-ups

- The `cfo` (and other recipes') wrong tool names — tracked separately; this spec
  only fixes `ceo`.
- Objective/report **writes** by agents (so the CEO can edit objectives, not just
  read) — phase 2, once write-auth is designed.
- Repointing all 35 catalog recipes off org.openape.ai — enabled by component 1,
  done separately.

## Acceptance

1. From an OpenApe member agent's token, `GET troop.openape.ai/api/orgs/38f8e8e9…/objectives`
   returns 200 (not 401); a foreign owner's agent still gets 401; writes still 401 for agents.
2. `ceo` bridge boots with the real tools (bridge log shows the tool set, not `tools=[none]`)
   and no `unknown tool(s)` runtime error on a turn.
3. Patrick DMs the new Telegram bot "Status?" → gets a real team status (tasks by
   assignee + recent PRs + objectives), owner-pinned (a non-owner is ignored).
4. At 08:00 Europe/Vienna a standup digest arrives in Telegram unprompted.
5. Patrick DMs "fokus auf X" → a task is created + assigned (visible in `ape-tasks list`).
