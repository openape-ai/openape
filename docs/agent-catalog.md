# Agent Catalog

The Agent Catalog is the source of truth for all personas available to assemble a virtual company in OpenApe.

## What is the Agent Catalog?

The Agent Catalog defines the 29 personas you can spawn as team members. Each persona:

- Maps to a pinned recipe in [github.com/openape-ai/agent-catalog](https://github.com/openape-ai/agent-catalog)
- Has a structural ORG `role` (ceo, teamlead, specialist, sanierer, other)
- Carries a title, icon, and description for the OrgChart UI
- Specifies whether the persona works with code (Forgejo)
- Includes recipe parameters that are substituted at spawn time (`{{org_id}}`, `{{org_name}}`)

The catalog is auto-generated from `catalog.json` by the build script `agent-catalog/_build/generate.mjs`. The generated file `apps/openape-troop/server/utils/persona-catalog.ts` is the runtime source of truth.

## How to Assemble a Company via ORG

1. **Start with Leadership**: Spawn the CEO first to turn your vision into objectives.
2. **Add Team Leads**: Add CTO, Product Manager, Engineering Manager, or Project Manager as needed.
3. **Fill Specialist Roles**: Add engineers, designers, analysts, and support roles based on your needs.
4. **Add Finance/Legal**: Consider Finance Controller (Sanierer) for budget oversight and Legal & Compliance Officer for risk review.

The OrgChart UI (`apps/openape-troop/app/components/company/`) displays all spawned members with their persona titles and icons.

## Current ORG Composition: OpenApe Werkstatt

The OpenApe Werkstatt org (id: `38f8e8e9-eec5-440c-b716-6c0f8224270c`) currently has 6 active members:

| Agent | Persona | Role | Reports To |
|-------|---------|------|------------|
| ceo | Chief Executive (CEO) | ceo | — |
| pm | Product Manager | teamlead | — |
| cfo | Finance Controller (Sanierer) | sanierer | — |
| backend | Backend Engineer | specialist | pm |
| qa | QA / Test Engineer | specialist | pm |
| scribe | Technical Writer | specialist | pm |

**Structure**: The CEO, PM, and CFO report directly to the Owner. The Backend Engineer, QA Engineer, and Technical Writer report to the Product Manager.

## Available Personas

### Leadership & Coordination

| Persona | Role | Icon | Coding | Summary |
|---------|------|------|--------|---------|
| Chief Executive (CEO) | ceo | i-lucide-crown | No | Turns the Owner's vision into objectives and keeps the company pointed at them. |
| Chief Technology Officer (CTO) | teamlead | i-lucide-cpu | Yes | Owns technical strategy, architecture direction and engineering standards. |
| Product Manager | teamlead | i-lucide-compass | No | Maintains the backlog — converts goals into well-specified, prioritized tasks. |
| Engineering Manager | teamlead | i-lucide-users | No | Decomposes engineering objectives into stories and routes them to engineers. |
| Project / Delivery Manager | teamlead | i-lucide-calendar-clock | No | Keeps timelines, dependencies and risks visible; chases blockers across teams. |

### Engineering

| Persona | Role | Icon | Coding | Summary |
|---------|------|------|--------|---------|
| Backend Engineer | specialist | i-lucide-server | Yes | Implements server-side features, APIs and data access against assigned issues. |
| Frontend Engineer | specialist | i-lucide-layout-dashboard | Yes | Builds UI components and flows; verifies them render and behave correctly. |
| Full-Stack Engineer | specialist | i-lucide-layers | Yes | Ships end-to-end features spanning UI, API and data. |
| DevOps Engineer | specialist | i-lucide-container | Yes | Owns CI/CD, containers and deploy pipelines (proposes, never self-deploys prod). |
| Site Reliability Engineer (SRE) | specialist | i-lucide-activity | Yes | Watches health/SLOs, triages incidents, files and fixes reliability issues. |
| QA / Test Engineer | specialist | i-lucide-bug | Yes | Writes and strengthens tests; reproduces bugs before they are fixed. |
| Security Engineer | specialist | i-lucide-shield-check | Yes | Reviews changes for vulnerabilities and hardens the codebase (read-first). |
| Data Engineer | specialist | i-lucide-database | Yes | Builds and maintains data pipelines, schemas and ETL jobs. |
| ML Engineer | specialist | i-lucide-brain-circuit | Yes | Prototypes, evaluates and ships ML/LLM features with honest metrics. |
| Mobile Engineer | specialist | i-lucide-smartphone | Yes | Implements mobile/cross-platform app features and verifies builds. |
| Code Reviewer | specialist | i-lucide-git-pull-request-arrow | Yes | Reviews open PRs for correctness, style and risk — approves or requests changes. |
| Release Manager | specialist | i-lucide-rocket | Yes | Owns the merge gate and release notes; coordinates safe rollouts (Owner approves prod). |

### Design & Content

| Persona | Role | Icon | Coding | Summary |
|---------|------|------|--------|---------|
| Technical Writer | specialist | i-lucide-book-open | Yes | Writes and updates docs from the code and shipped changes — keeps docs from drifting. |
| UX Designer | specialist | i-lucide-palette | No | Specifies flows, interaction and copy so frontend engineers can build without guessing. |
| Content Marketer | specialist | i-lucide-pen-tool | No | Produces blog, social and announcement copy from real shipped work. |

### Data & Research

| Persona | Role | Icon | Coding | Summary |
|---------|------|------|--------|---------|
| Data Analyst | specialist | i-lucide-bar-chart-3 | No | Answers questions from data with honest, reproducible analysis. |
| Research Analyst | specialist | i-lucide-search | No | Runs multi-source research and delivers cited, fact-checked briefs. |

### Growth & Sales

| Persona | Role | Icon | Coding | Summary |
|---------|------|------|--------|---------|
| Growth Marketer | specialist | i-lucide-trending-up | No | Designs and tracks growth experiments; reports what actually moved the metric. |
| Sales Development Rep | specialist | i-lucide-handshake | No | Researches leads and drafts tailored outreach for the Owner to send. |

### Operations & Support

| Persona | Role | Icon | Coding | Summary |
|---------|------|------|--------|---------|
| Customer Support Agent | specialist | i-lucide-life-buoy | No | Triage support requests, answers what it can, routes the rest with context. |
| Community Manager | specialist | i-lucide-messages-square | No | Monitors community channels, summarizes signal, drafts responses. |
| Recruiter / People Ops | specialist | i-lucide-user-plus | No | Identifies capability gaps and proposes which persona to spawn next. |

### Finance & Legal

| Persona | Role | Icon | Coding | Summary |
|---------|------|------|--------|---------|
| Finance Controller (Sanierer) | sanierer | i-lucide-piggy-bank | No | Watches budget and cost/output ratio; alerts the Owner directly on breaches. |
| Legal & Compliance Officer | specialist | i-lucide-scale | No | Reviews content and changes for legal/compliance risk; flags, never approves. |

## Recipe References

All personas reference pinned recipes from `github.com/openape-ai/agent-catalog` at specific versions (currently `@v0.2.0`). The recipe includes the agent configuration, system prompts, and tool definitions.

## Source Files

- **Source of truth**: `catalog.json` (in the agent-catalog repo)
- **Generated**: `apps/openape-troop/server/utils/persona-catalog.ts`
- **Build script**: `agent-catalog/_build/generate.mjs`

Do not edit `persona-catalog.ts` by hand. Changes to the catalog must come from updating `catalog.json` and regenerating.
