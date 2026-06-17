# OpenApe CEO in Telegram + Team Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenApe CEO (`ceo` agent) a working, Telegram-reachable status+steering interface that can read the team's tasks, PRs, and troop-company data, and pushes a daily standup.

**Architecture:** Repair the existing `ceo` agent. Add server-side agent-read-auth on troop org endpoints, a read-only `troop.*` runtime tool that authenticates with the agent's own DDISA token (via `@openape/cli-auth`), fix the CEO recipe (real tools + repoint off dead org.openape.ai + status/steering protocol + daily standup), and wire Telegram via the sealed-secret path.

**Tech stack:** Nuxt/h3 (troop), TypeScript, `@openape/cli-auth`, `@openape/core` (`parseAgentEmail`), tsup bundling, Docker/pm2 nest, Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-06-16-openape-ceo-telegram-design.md`

**Key constants:**
- OpenApe Werkstatt org id: `38f8e8e9-eec5-440c-b716-6c0f8224270c`
- ceo agent email: `ceo-cb6bf26a+patrick+hofmann_eco@id.openape.ai`
- owner: `patrick@hofmann.eco`
- Telegram token: local file `~/.config/openape/telegram-openape-ceo-bot.token` (bot `@openape_ceo_bot`)
- nest container TZ is `Etc/UTC` (matters for the standup cron)

---

## Task 1: Troop agent-read-auth helper

**Files:**
- Modify: `apps/openape-troop/server/utils/orgs.ts` (add `requireOrgReadAccess`)
- Modify: `apps/openape-troop/server/utils/auth.ts` (export caller identity incl. `act`)
- Test: `apps/openape-troop/test/org-read-access.test.ts`

Current `resolveOwnerContext` (auth.ts) returns `owner = cli.sub` — for an agent token that's the *agent* email, not the owner. We need the caller's `act` + `sub` so we can derive the real owner for agents.

- [ ] **Step 1: Add `resolveCallerIdentity` to auth.ts** — returns `{ sub, act }` from the same three transports (session → act='human'; troop CLI token → `{sub: cli.sub, act: cli.act}`; IdP human → act='human').

```typescript
// apps/openape-troop/server/utils/auth.ts
export async function resolveCallerIdentity(event: H3Event): Promise<{ sub: string, act: 'human' | 'agent' }> {
  const session = await getSpSession(event)
  const sessionEmail = (session.data as { claims?: DDISAClaims })?.claims?.sub
  if (sessionEmail) return { sub: sessionEmail, act: 'human' }
  const auth = getHeader(event, 'Authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim()
    const cli = await verifyCliToken(token)
    if (cli) return { sub: cli.sub, act: cli.act === 'agent' ? 'agent' : 'human' }
    const idpUrl = useRuntimeConfig().public.idpUrl as string
    try {
      const result = await verifyJWT(token, getJwks(), { issuer: idpUrl })
      const claims = result.payload as DDISAClaims
      const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
      if (auds.includes(CLI_AUDIENCE) && typeof claims.sub === 'string') {
        return { sub: claims.sub, act: claims.act === 'agent' ? 'agent' : 'human' }
      }
    }
    catch { /* fall through */ }
  }
  problem(401, 'Authentication required')
}
```

- [ ] **Step 2: Add `requireOrgReadAccess` to orgs.ts**

```typescript
// apps/openape-troop/server/utils/orgs.ts
import { parseAgentEmail } from '@openape/core'
import { resolveCallerIdentity } from './auth'

/** Read access: the org owner, or an agent owned by the org owner. Writes still use requireOwnedOrg. */
export async function requireOrgReadAccess(event: H3Event) {
  const { sub, act } = await resolveCallerIdentity(event)
  const ownerEmail = act === 'agent' ? (parseAgentEmail(sub)?.ownerEmail ?? sub) : sub
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'org id required' })
  const db = useDb()
  const rows = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1)
  const org = rows[0]
  if (!org) throw createError({ statusCode: 404, statusMessage: 'organization not found' })
  if (org.ownerEmail.toLowerCase() !== ownerEmail.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: 'not your organization' })
  }
  return { caller: sub, ownerEmail, org }
}
```

- [ ] **Step 3: Write tests** (`apps/openape-troop/test/org-read-access.test.ts`) covering: owner-derivation for an agent sub (`ceo-…+patrick+hofmann_eco@…` → `patrick@hofmann.eco`), human sub passthrough. Mock the org lookup; assert 403 for a foreign owner and pass for the matching owner. Use the existing troop test harness pattern (check `apps/openape-troop/test/` for an example).

- [ ] **Step 4: Run** `pnpm --filter openape-troop test -- org-read-access` → PASS.

- [ ] **Step 5: Swap GET handlers to `requireOrgReadAccess`** in:
  - `apps/openape-troop/server/api/orgs/[id]/index.get.ts`
  - `apps/openape-troop/server/api/orgs/[id]/members/index.get.ts`
  - `apps/openape-troop/server/api/orgs/[id]/objectives/index.get.ts`
  - `apps/openape-troop/server/api/orgs/[id]/reports/index.get.ts`
  - `apps/openape-troop/server/api/orgs/[id]/cost-snapshots/index.get.ts`

  Replace `const { org } = await requireOwnedOrg(event)` with `const { org } = await requireOrgReadAccess(event)`. Leave all non-GET handlers (patch/delete/post) on `requireOwnedOrg`.

- [ ] **Step 6:** `pnpm turbo run typecheck lint --filter=openape-troop` → green. Commit.

---

## Task 2: `troop.*` read-only runtime tool

**Files:**
- Create: `packages/agent-runtime/src/agent-tools/troop.ts`
- Modify: `packages/agent-runtime/src/agent-tools/index.ts` (register in TOOLS)
- Test: `packages/agent-runtime/test/troop-tool.test.ts`

Pattern: like `tasks.ts`, but instead of shelling out it uses `@openape/cli-auth` `getAuthorizedBearer` (the agent's own identity) and fetches the troop org API. `http.get` can't be used (it strips Authorization).

- [ ] **Step 1: Write the tool** — one tool `troop.company.read` with arg `{ resource: 'objectives'|'reports'|'members'|'cost-snapshots'|'overview', org_id: string }`.

```typescript
// packages/agent-runtime/src/agent-tools/troop.ts
import { getAuthorizedBearer } from '@openape/cli-auth'
import type { ToolDefinition } from './index.js'

const TROOP = 'https://troop.openape.ai'
const RESOURCES = ['objectives', 'reports', 'members', 'cost-snapshots', 'overview'] as const

export const troopTools: ToolDefinition[] = [{
  name: 'troop.company.read',
  description: 'Read your troop company data: objectives, reports, members, cost-snapshots, or overview (vision+budget). Read-only.',
  parameters: {
    type: 'object',
    properties: {
      resource: { type: 'string', enum: [...RESOURCES], description: 'Which company resource to read.' },
      org_id: { type: 'string', description: 'Company (org) id.' },
    },
    required: ['resource', 'org_id'],
  },
  execute: async (args: unknown) => {
    const { resource, org_id } = args as { resource: string, org_id: string }
    if (!RESOURCES.includes(resource as typeof RESOURCES[number])) throw new Error(`unknown resource: ${resource}`)
    const bearer = await getAuthorizedBearer({ endpoint: TROOP, aud: 'troop.openape.ai' })
    const path = resource === 'overview' ? `/api/orgs/${encodeURIComponent(org_id)}` : `/api/orgs/${encodeURIComponent(org_id)}/${resource}`
    const res = await fetch(`${TROOP}${path}`, { headers: { authorization: bearer } })
    if (!res.ok) throw new Error(`troop ${resource} ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return JSON.stringify(await res.json())
  },
}]
```

- [ ] **Step 2: Register** in `packages/agent-runtime/src/agent-tools/index.ts` — add `troopTools` to the array that builds `TOOLS` (follow the existing `Object.fromEntries(... .map(t => [t.name, t]))` pattern).

- [ ] **Step 3: Test** (`troop-tool.test.ts`): mock `getAuthorizedBearer` + global `fetch`; assert it calls `/api/orgs/<id>/objectives` with the bearer, returns the JSON, and throws on a non-ok status + on an unknown resource.

- [ ] **Step 4: Run** `pnpm --filter @openape/agent-runtime test -- troop-tool` → PASS. Then `pnpm turbo run typecheck lint --filter=@openape/agent-runtime`. Commit.

---

## Task 3: CEO recipe repair

**Files:**
- Modify: `/Users/patrickhofmann/Companies/private/repos/openape/agent-catalog/ceo/ape-agent.yaml`

- [ ] **Step 1: Fix the tools list** (`tools:` block) to real registered names:
```yaml
tools:
  - tasks.list
  - tasks.create
  - forge.pr.status
  - forge.issue.get
  - time.now
  - troop.company.read
```

- [ ] **Step 2: Rewrite `intent`** — replace every `org.openape.ai/api/orgs/{{org_id}}…` curl with the `troop.company.read` tool (resource=objectives/reports/overview, org_id={{org_id}}). Reframe the mandate as **status + light steering**:
  - On an owner message → produce a live status: team tasks grouped by assignee (`tasks.list`), open/doing + blockers, recent PRs (`forge.pr.status`), current objectives (`troop.company.read overview/objectives`). Numbers + links, brief.
  - On an owner directive → `tasks.create` assigned to `pm-orchestrator` or the right persona. (Objective writes are owner-only for now — note it, don't attempt.)
  - Keep the existing guardrails block.

- [ ] **Step 3: Set the standup schedule** — replace the weekly `schedules:` entry with a daily standup:
```yaml
schedules:
  - cron: "0 8 * * *"
    description: |
      Daily standup: compile a short status — what each teammate is working on
      (tasks.list, grouped by assignee), recent PRs (forge.pr.status), blockers,
      and the current objectives (troop.company.read) — and DM it to the Owner.
```
  (08:00 wall-clock; TZ handled in Task 6.)

- [ ] **Step 4: Confirm `params` carries `org_id`** so `{{org_id}}` interpolates to `38f8e8e9-eec5-440c-b716-6c0f8224270c` when the recipe is applied (the recipe POST passes params).

- [ ] **Step 5: Commit + push** the agent-catalog repo (Forgejo-authoritative; push so the recipe POST can fetch the new ref). Note the new commit sha/tag for Task 5.

---

## Task 4: Publish + bake the new tool into the runtime

The `troop.company.read` tool lives in `@openape/agent-runtime`, consumed by `@openape/apes` → the bridge bundle. The nest runs the baked `bridge.mjs`.

- [ ] **Step 1: Version-bump + publish** `@openape/agent-runtime` (and `@openape/apes` which re-exports it) via the surgical bump pattern: bump `packages/agent-runtime/package.json` patch, `pnpm release:dry` to confirm scope, `pnpm release`. (cli-auth already at 0.5.1.)
- [ ] **Step 2: Rebuild the bridge bundle** `pnpm turbo run build --filter=@openape/ape-agent` → `apps/openape-ape-agent/dist/bridge.mjs`.
- [ ] **Step 3: Deploy to the running nest** — `docker cp` the bundle to `openape-nest:/opt/openape/ape-agent/dist/bridge.mjs`; rebuild `openape-nest:latest` (durability) per the established flow.
- [ ] **Step 4: Deploy troop** — `pnpm run deploy:image troop` (ships the Task 1 agent-read-auth).
- [ ] **Step 5: Verify deploy** — external `curl` of `troop.openape.ai/api/orgs/38f8e8e9…/objectives` with a member agent's token → 200; with a foreign token → 401/403.

---

## Task 5: Apply the repaired recipe to the running `ceo`

- [ ] **Step 1: POST the recipe** — `POST https://troop.openape.ai/api/agents/ceo/recipe` (owner-auth) with `{ "repo_ref": "openape-ai/agent-catalog/ceo@<sha>", "params": { "org_id": "38f8e8e9-eec5-440c-b716-6c0f8224270c", "org_name": "OpenApe Werkstatt" } }`. Use the apes/ape-troop owner token.
- [ ] **Step 2: Confirm persistence** — troop `agents.tools` for ceo now lists the 6 tools; `system_prompt` updated; a `tasks` row exists with `cron="0 8 * * *"`.
- [ ] **Step 3: Restart the ceo bridge** so it re-syncs agent.json + tasks: `PM2_HOME=/var/lib/openape/homes/ceo/.pm2 pm2 restart openape-bridge-ceo`. Bridge log should show the tool set (not `tools=[none]`).
- [ ] **Step 4: Pull test** — send a chat message to `ceo` via `POST troop.openape.ai/api/agents/ceo/chat/messages {"body":"Status?"}` → it replies with a real team status (no `unknown tool` error).

---

## Task 6: Telegram channel + timezone

- [ ] **Step 1: Provision the bot token as a sealed secret** — `PUT https://troop.openape.ai/api/agents/ceo/secrets/TELEGRAM_BOT_TOKEN` (owner-auth) with `{ "value": "<contents of ~/.config/openape/telegram-openape-ceo-bot.token>" }`. (Read the file; never echo the value into logs/commits.)
- [ ] **Step 2: Set TZ for correct 08:00 Vienna** — the nest is UTC, cron-runner uses wall-clock. Add `TZ=Europe/Vienna` to the ceo bridge's pm2 env (via the nest's bridge env), OR if that's not plumbed, set the cron to `0 6 * * *` (= 08:00 CEST) and add a code comment that it's DST-naive. Prefer `TZ` if the supervisor forwards it.
- [ ] **Step 3: Restart ceo bridge**; confirm log shows the Telegram adapter starting (token picked up from the relayed sealed blob).
- [ ] **Step 4: Owner-pin** — Patrick DMs `@openape_ceo_bot` once ("Status?") → trust-on-first-use writes `telegram-owner.json`; the CEO replies in Telegram. A message from a non-owner Telegram account is ignored.

---

## Task 7: End-to-end acceptance

- [ ] **A1** Member-agent token → `GET /api/orgs/38f8e8e9…/objectives` = 200; foreign agent = 403; agent write (PATCH) still 401/403.
- [ ] **A2** ceo bridge boots with the 6 tools; a turn runs with no `unknown tool(s)` error.
- [ ] **A3** Patrick DMs `@openape_ceo_bot` "Status?" → real status (tasks by assignee + recent PRs + objectives); owner-pinned.
- [ ] **A4** At 08:00 Europe/Vienna a standup digest arrives in Telegram unprompted (or force-fire the task once to verify without waiting).
- [ ] **A5** Patrick DMs "fokus auf X" → a task is created + assigned (visible in `ape-tasks list`).

---

## Notes / risks
- **Least privilege:** the CEO gets a read-only `troop.company.read` tool, not `bash` — it cannot run arbitrary shell.
- **Same tool-name bug class as cfo:** this plan fixes ceo's tool names correctly; cfo is a separate task.
- **Standup TZ:** verify whether the pm2 supervisor forwards `TZ`; if not, use the UTC-offset cron with a DST note.
- **Recipe push:** the recipe POST fetches from the catalog repo at a ref — Task 3 must be pushed before Task 5.
