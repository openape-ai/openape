# OpenApe Werkstatt — the agent company I built in your name (2026-06-13)

Driven end-to-end as Patrick (apes login session), via CLI + APIs.

## What is LIVE
- **Org:** "OpenApe Werkstatt" — `38f8e8e9-eec5-440c-b716-6c0f8224270c`
  (org.openape.ai), vision set, budget €200/mo.
- **Chart:** 6 founders. Active (spawned): `ceo`, `pm`, `cfo`. Invited (planned):
  `backend`, `qa`, `scribe`.
- **5 Objectives** (CEO-authored) + **7-task backlog** in tasks.openape.ai team
  `01KV0XTPETENZ42S5GE6GRPGDG`, each task pre-assigned to a founder's predicted
  email (`<name>-cb6bf26a+patrick+hofmann_eco@id.openape.ai`).
- **3 live agents on nest `mbp-home`:** ceo / pm / cfo — each carries its full
  persona system-prompt (≈3.4k chars), `recipe=<persona>@v0.2.0`, an **enabled
  schedule** (ceo `0 8 * * 1`, pm `0 */4 * * *`, cfo `0 */2 * * *`), and a **YOLO
  policy** (`deny-list`, `--deny-risk high`, deny `rm -rf`/`force-push`/`pr merge`/
  `shutdown`) — I auto-approve their normal work in your name; high-risk still
  escalates to you.

## Two real gotchas I hit (and the lesson)
1. **CLI `apes agent deploy <recipe>` names the agent after the RECIPE**, not the
   short name → it created a stray `product-manager` (destroyed). Fix used:
   deploy by exact agent name via `POST troop /api/agents/<name>/recipe`.
   The **ORG chart spawn flow** (what we shipped) avoids this — it sends
   name+recipe together. Prefer it over the CLI for the rest.
2. **Nest enroll-agent delegation is exhausted** after a few consecutive spawns
   → `backend`/`qa`/`scribe` did NOT provision ("no enroll-agent delegation from
   patrick to nest-openape-nest…"). Renew the delegation, then spawn the three.

## The one open wiring gap (worth a real fix)
Fresh persona agents are **not auto-joined to the owner's task team**, so their
`tasks.list` / `ape-tasks list` sees nothing → the seeded backlog won't flow yet.
There is no owner-side "add member" API (probed: 404) — only invite+accept, which
must run **as each agent on the nest**. 

**Finish (run once on mbp-home, per live agent user):**
`ape-tasks accept "https://tasks.openape.ai/invite?t=<token>"`
(invite token created, 20 uses, 30d — in the session log).

**Better fix (product):** spawn should auto-join the agent to a designated team,
or the persona recipe should take a `tasks_team`/invite param and accept on first
run. That closes "assign work in the UI → agent picks it up" with zero manual steps.

## IDs
- org `38f8e8e9-eec5-440c-b716-6c0f8224270c`
- task team `01KV0XTPETENZ42S5GE6GRPGDG`
- agent email pattern `<name>-cb6bf26a+patrick+hofmann_eco@id.openape.ai`

## Stop/scale
- Pause an agent: disable its schedule task, or `ape-troop agents destroy <name>`.
- The `cfo` (finance-controller) watches the €200 budget and reports breaches.
