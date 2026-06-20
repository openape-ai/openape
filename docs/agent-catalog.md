# Agent Catalog

The agent catalog is the source of truth for all personas available in OpenApe. Each persona represents a role the Owner can spawn as an agent to help run their company.

## What is the Agent Catalog?

The agent catalog defines 29 personas, each mapping to a pinned recipe from [github.com/openape-ai/agent-catalog](https://github.com/openape-ai/agent-catalog). When the Owner spawns an agent from the org chart, the system:

1. Looks up the persona by its key
2. Deploys the corresponding recipe at the pinned version
3. Assigns the agent its structural ORG role (ceo, teamlead, specialist, or sanierer)
4. Connects the agent to the company via DDISA identity

The catalog lives in `apps/openape-org/server/utils/persona-catalog.ts` and is auto-generated from the canonical source.

## Persona Categories

Personas are grouped into 7 categories:

| Category | Key | Description |
|----------|-----|-------------|
| Leadership & Coordination | `leadership` | Executive and management roles |
| Engineering | `engineering` | Technical implementation roles |
| Design & Content | `design-content` | UX, content, and marketing roles |
| Data & Research | `data-research` | Analysis and research roles |
| Growth & Sales | `growth-sales` | Business development roles |
| Operations & Support | `operations` | Customer and community roles |
| Finance & Legal | `finance-legal` | Financial and compliance roles |

## The 29 Personas

### Leadership & Coordination

| Persona | Key | Role | Icon | Coding | Summary |
|---------|-----|------|------|--------|---------|
| Chief Executive (CEO) | `ceo` | ceo | crown | No | Turns the Owner's vision into objectives and keeps the company pointed at them. |
| Chief Technology Officer (CTO) | `cto` | teamlead | cpu | Yes | Owns technical strategy, architecture direction and engineering standards. |
| Product Manager | `product-manager` | teamlead | compass | No | Maintains the backlog — converts goals into well-specified, prioritized tasks. |
| Engineering Manager | `engineering-manager` | teamlead | users | No | Decomposes engineering objectives into stories and routes them to engineers. |
| Project / Delivery Manager | `project-manager` | teamlead | calendar-clock | No | Keeps timelines, dependencies and risks visible; chases blockers across teams. |

### Engineering

| Persona | Key | Role | Icon | Coding | Summary |
|---------|-----|------|------|--------|---------|
| Backend Engineer | `backend-engineer` | specialist | server | Yes | Implements server-side features, APIs and data access against assigned issues. |
| Frontend Engineer | `frontend-engineer` | specialist | layout-dashboard | Yes | Builds UI components and flows; verifies them render and behave correctly. |
| Full-Stack Engineer | `fullstack-engineer` | specialist | layers | Yes | Ships end-to-end features spanning UI, API and data. |
| DevOps Engineer | `devops-engineer` | specialist | container | Yes | Owns CI/CD, containers and deploy pipelines (proposes, never self-deploys prod). |
| Site Reliability Engineer (SRE) | `site-reliability-engineer` | specialist | activity | Yes | Watches health/SLOs, triages incidents, files and fixes reliability issues. |
| QA / Test Engineer | `qa-engineer` | specialist | bug | Yes | Writes and strengthens tests; reproduces bugs before they are fixed. |
| Security Engineer | `security-engineer` | specialist | shield-check | Yes | Reviews changes for vulnerabilities and hardens the codebase (read-first). |
| Data Engineer | `data-engineer` | specialist | database | Yes | Builds and maintains data pipelines, schemas and ETL jobs. |
| ML Engineer | `ml-engineer` | specialist | brain-circuit | Yes | Prototypes, evaluates and ships ML/LLM features with honest metrics. |
| Mobile Engineer | `mobile-engineer` | specialist | smartphone | Yes | Implements mobile/cross-platform app features and verifies builds. |
| Code Reviewer | `code-reviewer` | specialist | git-pull-request-arrow | Yes | Reviews open PRs for correctness, style and risk — approves or requests changes. |
| Release Manager | `release-manager` | specialist | rocket | Yes | Owns the merge gate and release notes; coordinates safe rollouts (Owner approves prod). |
| Technical Writer | `technical-writer` | specialist | book-open | Yes | Writes and updates docs from the code and shipped changes — keeps docs from drifting. |

### Design & Content

| Persona | Key | Role | Icon | Coding | Summary |
|---------|-----|------|------|--------|---------|
| UX Designer | `ux-designer` | specialist | palette | No | Specifies flows, interaction and copy so frontend engineers can build without guessing. |
| Content Marketer | `content-marketer` | specialist | pen-tool | No | Produces blog, social and announcement copy from real shipped work. |

### Data & Research

| Persona | Key | Role | Icon | Coding | Summary |
|---------|-----|------|------|--------|---------|
| Data Analyst | `data-analyst` | specialist | bar-chart-3 | No | Answers questions from data with honest, reproducible analysis. |
| Research Analyst | `research-analyst` | specialist | search | No | Runs multi-source research and delivers cited, fact-checked briefs. |

### Growth & Sales

| Persona | Key | Role | Icon | Coding | Summary |
|---------|-----|------|------|--------|---------|
| Growth Marketer | `growth-marketer` | specialist | trending-up | No | Designs and tracks growth experiments; reports what actually moved the metric. |
| Sales Development Rep | `sales-development-rep` | specialist | handshake | No | Researches leads and drafts tailored outreach for the Owner to send. |

### Operations & Support

| Persona | Key | Role | Icon | Coding | Summary |
|---------|-----|------|------|--------|---------|
| Customer Support Agent | `customer-support-agent` | specialist | life-buoy | No | Triage support requests, answers what it can, routes the rest with context. |
| Community Manager | `community-manager` | specialist | messages-square | No | Monitors community channels, summarizes signal, drafts responses. |
| Recruiter / People Ops | `recruiter` | specialist | user-plus | No | Identifies capability gaps and proposes which persona to spawn next. |

### Finance & Legal

| Persona | Key | Role | Icon | Coding | Summary |
|---------|-----|------|------|--------|---------|
| Finance Controller (Sanierer) | `finance-controller` | sanierer | piggy-bank | No | Watches budget and cost/output ratio; alerts the Owner directly on breaches. |
| Legal & Compliance Officer | `legal-compliance-officer` | specialist | scale | No | Reviews content and changes for legal/compliance risk; flags, never approves. |

## ORG Structural Roles

Each persona occupies a structural role in the company org chart:

| Role | Description |
|------|-------------|
| `ceo` | The top-level executive role (only the CEO persona) |
| `teamlead` | Team leadership roles that decompose work (CTO, PM, EM, PJM) |
| `specialist` | Individual contributor roles that execute work (all engineers, analysts, etc.) |
| `sanierer` | Special oversight role for financial control (Finance Controller) |
| `other` | Reserved for future use |

## How to Compose a Company via ORG

The Owner composes a company by spawning agents from the org chart at `org.openape.ai`:

1. **Navigate to the org chart** — The Owner sees the current company structure with empty slots for each persona role.

2. **Spawn an agent** — Click on an empty persona slot, select the persona from the picker (grouped by category), and confirm spawn.

3. **Agent initialization** — The system:
   - Creates a DDISA identity for the agent
   - Deploys the pinned recipe from the agent-catalog
   - Substitutes `{{org_id}}` and `{{org_name}}` in recipe parameters
   - Connects the agent to the company's troop and chat systems

4. **Agent activation** — The agent appears in the org chart with its persona title and icon, and can immediately start working on objectives assigned by its team lead or the CEO.

### Recipe Parameters

All personas receive these standard parameters at spawn time:
- `org_id` — The company's UUID
- `org_name` — The company's display name

Some personas (coding roles) also receive:
- `forge_base` — The Forgejo instance URL (`https://git.openape.ai`)

The CEO, CTO, and Product Manager recipes also accept `org_id` and `org_name` for company context.

## Source of Truth

- **Catalog definition**: `apps/openape-org/server/utils/persona-catalog.ts` (auto-generated)
- **Recipe source**: [github.com/openape-ai/agent-catalog](https://github.com/openape-ai/agent-catalog)
- **API endpoint**: `GET /api/personas` on `org.openape.ai` returns the full catalog

## Adding a New Persona

To add a new persona:

1. Create a recipe in the `agent-catalog` repo under a new subdirectory
2. Update the `PERSONAS` array in `persona-catalog.ts` with the new persona definition
3. Run the generator: `cd apps/openape-org && pnpm generate:catalog` (if applicable)
4. Update this documentation with the new persona
5. Open a PR for review

The catalog is auto-generated to prevent drift between the source recipe and the deployed definition.
