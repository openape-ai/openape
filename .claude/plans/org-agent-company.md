# Plan: ORG → Troop agent company (24 persona recipes, autonomous task polling)

**Date:** 2026-06-13 · **Owner:** Patrick · **Mode:** autonomous, no check-ins requested.

## Goal
Let the Owner assemble a whole company of agents in ORG (org.openape.ai), each
spawned from a **persona recipe** in the `agent-catalog`. Agents poll their own
work autonomously from **tasks.openape.ai** (`ape-tasks`, filtered to their
assignee email) and **git.openape.ai** (Forgejo issues/PRs) and process it —
no per-task prompt writing.

## What exists (verified)
- ORG `org_members.role` ∈ {ceo,teamlead,specialist,sanierer,other}; `spawn-member.ts`
  reads `getRoleDefaults(role)` → `{recipeRef?, recipeParams?, systemPrompt?}` and
  POSTs troop `/api/agents/spawn-intent` with `recipe:{repo_ref,params}` or `system_prompt`.
- Troop fetches `ape-agent.yaml` from `raw.githubusercontent.com/<owner>/<repo>/<ref>/<subdir>/`.
  Manifest schema: `name,kind:agent,intent,capabilities[],params[],schedules[],user_addendum,tools[]`.
  Scheduled-task tools are forced to `['bash','http','file','time']`.
- Cron subset: 5 fields; `*`, `N`, `*/N` (step only on minute+hour). No lists/ranges.
- `ape-tasks list --status open,doing --json` aggregates across the agent's teams;
  `edit/done/status/new` + `--json`. Auth via device `apes login` (agent identity).

## Deliverables
1. **`agent-catalog/`** standalone repo content: 24 persona subdirs, each
   `ape-agent.yaml` + `README.md`; root `README.md` + `catalog.json` + generator.
   Shared OPERATING PROTOCOL (poll tasks.openape.ai + git.openape.ai → work → report → done).
2. **ORG wiring**: `persona-catalog.ts` (single source of truth), nullable
   `org_members.persona` column, `members POST` accepts `persona`, `spawn-member`
   resolves persona→recipe, `GET /api/personas`, `AddMemberDialog` persona picker, i18n.
3. **Verification**: every recipe passes the REAL troop `parseRecipe`+`materializeRecipe`;
   ORG typecheck green; UI screenshot of the picker; go-live doc (push+tag catalog).

## Acceptance
- `tsx scripts/validate-catalog.ts` → all 24 recipes OK (params interpolate clean).
- `pnpm turbo run typecheck --filter=@openape/org` → green.
- Screenshot of AddMemberDialog showing persona catalog.

## Go-live (single manual step, documented)
Push `agent-catalog/` to `github.com/openape-ai/agent-catalog`, tag `v0.1.0`.
ORG persona refs already pin `@v0.1.0`, so spawn works immediately after the tag.
