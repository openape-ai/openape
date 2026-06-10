# OpenApe Agent Catalog

The curated recipes for OpenApe agents — one repository, one
subdirectory per recipe, released as a whole with pinned version tags.

A recipe ref is `github.com/openape-ai/agent-catalog/<recipe>@<tag>`,
e.g. `github.com/openape-ai/agent-catalog/ceo@v0.1.0`. The nest checks
out the catalog at exactly that tag and uses only the recipe's
subdirectory; the Troop spawn dialog offers the curated entries
directly.

| Recipe | What it does |
|---|---|
| [`ceo`](./ceo) | CEO for an org.openape.ai organization — interprets the Owner's vision into objectives, grounded in live org data (read-only in v0.1) |
| [`service-agent`](./service-agent) | Pulls tasks from an SP task queue (GetNextTask/ResolveTask) and solves them with the nest's LLM |
| [`bluesky-summary`](./bluesky-summary) | Twice-daily digest of your Bluesky home timeline |

Every recipe is an `ape-agent.yaml` (intent, params, capabilities,
schedules, tools) plus optional `tools/` scripts. See any subdirectory
for the format.

## Releasing

Tags version the catalog as a whole (`v0.1.0`, `v0.2.0`, …) — the
ref-pin policy of Troop accepts version tags or commit SHAs only, never
floating branches.
