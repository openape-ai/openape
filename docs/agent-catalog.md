# Agent Catalog

The **agent-catalog** is the single source of truth for all AI agent personas available to compose a virtual company. It defines 29 distinct roles that the Owner can spawn via the ORG system to build a team tailored to specific objectives.

## What is the Agent Catalog?

The agent-catalog is a curated collection of agent recipes, each representing a specific persona with:

- A **pinned recipe reference** from `github.com/openape-ai/agent-catalog`
- A **structural ORG role** (ceo, teamlead, specialist, sanierer, other)
- **Category grouping** for easy discovery
- **Capability flags** (e.g., whether the persona works with code/Forgejo)
- **Recipe parameters** that are substituted at spawn time (`{{org_id}}`, `{{org_name}}`)

The catalog lives in the codebase at `apps/openape-org/server/utils/persona-catalog.ts` and is auto-generated from the upstream agent-catalog repository.

## The 29 Personas

### Leadership & Coordination

| Persona | Role | Description | Coding |
|---------|------|-------------|--------|
| **Chief Executive (CEO)** | ceo | Turns the Owner's vision into objectives and keeps the company pointed at them. | No |
| **Chief Technology Officer (CTO)** | teamlead | Owns technical strategy, architecture direction and engineering standards. | Yes |
| **Product Manager** | teamlead | Maintains the backlog — converts goals into well-specified, prioritized tasks. | No |
| **Engineering Manager** | teamlead | Decomposes engineering objectives into stories and routes them to engineers. | No |
| **Project / Delivery Manager** | teamlead | Keeps timelines, dependencies and risks visible; chases blockers across teams. | No |

### Engineering

| Persona | Role | Description | Coding |
|---------|------|-------------|--------|
| **Backend Engineer** | specialist | Implements server-side features, APIs and data access against assigned issues. | Yes |
| **Frontend Engineer** | specialist | Builds UI components and flows; verifies them render and behave correctly. | Yes |
| **Full-Stack Engineer** | specialist | Ships end-to-end features spanning UI, API and data. | Yes |
| **DevOps Engineer** | specialist | Owns CI/CD, containers and deploy pipelines (proposes, never self-deploys prod). | Yes |
| **Site Reliability Engineer (SRE)** | specialist | Watches health/SLOs, triages incidents, files and fixes reliability issues. | Yes |
| **QA / Test Engineer** | specialist | Writes and strengthens tests; reproduces bugs before they are fixed. | Yes |
| **Security Engineer** | specialist | Reviews changes for vulnerabilities and hardens the codebase (read-first). | Yes |
| **Data Engineer** | specialist | Builds and maintains data pipelines, schemas and ETL jobs. | Yes |
| **ML Engineer** | specialist | Prototypes, evaluates and ships ML/LLM features with honest metrics. | Yes |
| **Mobile Engineer** | specialist | Implements mobile/cross-platform app features and verifies builds. | Yes |
| **Code Reviewer** | specialist | Reviews open PRs for correctness, style and risk — approves or requests changes. | Yes |
| **Release Manager** | specialist | Owns the merge gate and release notes; coordinates safe rollouts (Owner approves prod). | Yes |

### Design & Content

| Persona | Role | Description | Coding |
|---------|------|-------------|--------|
| **Technical Writer** | specialist | Writes and updates docs from the code and shipped changes — keeps docs from drifting. | Yes |
| **UX Designer** | specialist | Specifies flows, interaction and copy so frontend engineers can build without guessing. | No |
| **Content Marketer** | specialist | Produces blog, social and announcement copy from real shipped work. | No |

### Data & Research

| Persona | Role | Description | Coding |
|---------|------|-------------|--------|
| **Data Analyst** | specialist | Answers questions from data with honest, reproducible analysis. | No |
| **Research Analyst** | specialist | Runs multi-source research and delivers cited, fact-checked briefs. | No |

### Growth & Sales

| Persona | Role | Description | Coding |
|---------|------|-------------|--------|
| **Growth Marketer** | specialist | Designs and tracks growth experiments; reports what actually moved the metric. | No |
| **Sales Development Rep** | specialist | Researches leads and drafts tailored outreach for the Owner to send. | No |

### Operations & Support

| Persona | Role | Description | Coding |
|---------|------|-------------|--------|
| **Customer Support Agent** | specialist | Triage support requests, answers what it can, routes the rest with context. | No |
| **Community Manager** | specialist | Monitors community channels, summarizes signal, drafts responses. | No |
| **Recruiter / People Ops** | specialist | Identifies capability gaps and proposes which persona to spawn next. | No |

### Finance & Legal

| Persona | Role | Description | Coding |
|---------|------|-------------|--------|
| **Finance Controller (Sanierer)** | sanierer | Watches budget and cost/output ratio; alerts the Owner directly on breaches. | No |
| **Legal & Compliance Officer** | specialist | Reviews content and changes for legal/compliance risk; flags, never approves. | No |

## Composing a Company via ORG

The Owner uses the ORG system to assemble a company from the available personas:

1. **Navigate to the org chart** in the troop interface
2. **Select personas** from the picker (grouped by category)
3. **Assign structural roles** — each persona occupies a specific position:
   - `ceo`: The top-level executive role
   - `teamlead`: Leadership positions that decompose work
   - `specialist`: Individual contributor roles
   - `sanierer`: Special intervention roles (e.g., Finance Controller)
   - `other`: Unclassified roles

4. **Spawn agents** — the system substitutes `{{org_id}}` and `{{org_name}}` with your organization's values
5. **Assign objectives** — spawn agents with specific tasks from the backlog

### Example Company Composition

A typical startup team might include:
- **CEO** (Leadership) — Vision and objective setting
- **CTO** (Leadership) — Technical strategy
- **Product Manager** (Leadership) — Backlog management
- **Backend Engineer** (Engineering) — Server-side development
- **Frontend Engineer** (Engineering) — UI development
- **QA Engineer** (Engineering) — Testing
- **Technical Writer** (Design & Content) — Documentation
- **Finance Controller** (Finance & Legal) — Budget monitoring

## Recipe References

All personas reference pinned versions from `github.com/openape-ai/agent-catalog`. The current catalog uses `@v0.2.0` for all recipes.

To update a persona's recipe:
1. Check for newer versions in the agent-catalog repository
2. Update the `recipeRef` in `persona-catalog.ts`
3. The file is auto-generated by `agent-catalog/_build/generate.mjs`

## Source of Truth

- **Persona definitions**: `apps/openape-org/server/utils/persona-catalog.ts`
- **Upstream recipes**: `github.com/openape-ai/agent-catalog`
- **Validation**: `apps/openape-troop/scripts/validate-catalog.ts`

Do not edit `persona-catalog.ts` manually — it is auto-generated from the agent-catalog repository.
