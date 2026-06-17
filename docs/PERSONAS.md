# OpenApe Agent Catalog

A catalog of **29 agent personas** ready to compose a virtual company. Each persona is a pinned recipe that troop fetches, validates, and deploys. Together they let an Owner assemble a whole virtual company in [ORG](https://org.openape.ai) — every member a real agent with its own DDISA identity that autonomously polls its work from [tasks.openape.ai](https://tasks.openape.ai) and [git.openape.ai](https://git.openape.ai).

- **Catalog version:** v0.2.0
- **Repo:** [github.com/openape-ai/agent-catalog](https://github.com/openape-ai/agent-catalog)
- **Total personas:** 29

## How autonomy works

Every persona shares one **operating protocol**. When its schedule fires:

1. Identify itself: `apes whoami --json`
2. Pull assigned tasks: `ape-tasks list --status open,doing --json`
3. Pick exactly one task (highest priority first)
4. Mark it in progress: `ape-tasks status <id> doing`
5. Do the work with its tools
6. Report back on the task and close it: `ape-tasks done <id>`

Blocked work is reassigned to the Owner with a note — never faked.

## Composing a company via ORG

To compose a company:

1. **Spawn the CEO first** — the Chief Executive turns the Owner's vision into objectives and keeps the company pointed at them.
2. **Add team leads** — CTO, Product Manager, Engineering Manager, or Project Manager to decompose objectives into tasks.
3. **Add specialists** — engineers, analysts, marketers, and support agents to execute the work.
4. **Assign tasks in the UI** — agents pick up work autonomously; you never write per-task prompts.

Each persona has a **role** that determines its position in the org chart:
- `ceo` — The company's strategic head
- `teamlead` — Decomposes objectives and routes work
- `specialist` — Executes specific tasks
- `sanierer` — Finance controller with direct Owner access

## Personas by Category

### Leadership & Coordination (5 personas)

| Persona | Role | Schedule | Summary |
|---|---|---|---|
| [Chief Executive (CEO)](../ceo/) | `ceo` | 0 8 * * 1 | Turns the Owner's vision into objectives and keeps the company pointed at them. |
| [Chief Technology Officer (CTO)](../cto/) | `teamlead` | 0 9 * * 1 | Owns technical strategy, architecture direction and engineering standards. |
| [Product Manager](../product-manager/) | `teamlead` | 0 */4 * * * | Maintains the backlog — converts goals into well-specified, prioritized tasks. |
| [Engineering Manager](../engineering-manager/) | `teamlead` | 0 */3 * * * | Decomposes engineering objectives into stories and routes them to engineers. |
| [Project / Delivery Manager](../project-manager/) | `teamlead` | 0 */6 * * * | Keeps timelines, dependencies and risks visible; chases blockers across teams. |

### Engineering (13 personas)

| Persona | Role | Schedule | Summary |
|---|---|---|---|
| [Backend Engineer](../backend-engineer/) | `specialist` | */15 * * * * | Implements server-side features, APIs and data access against assigned issues. |
| [Frontend Engineer](../frontend-engineer/) | `specialist` | */15 * * * * | Builds UI components and flows; verifies them render and behave correctly. |
| [Full-Stack Engineer](../fullstack-engineer/) | `specialist` | */15 * * * * | Ships end-to-end features spanning UI, API and data. |
| [DevOps Engineer](../devops-engineer/) | `specialist` | */20 * * * * | Owns CI/CD, containers and deploy pipelines (proposes, never self-deploys prod). |
| [Site Reliability Engineer (SRE)](../site-reliability-engineer/) | `specialist` | */10 * * * * | Watches health/SLOs, triages incidents, files and fixes reliability issues. |
| [QA / Test Engineer](../qa-engineer/) | `specialist` | */15 * * * * | Writes and strengthens tests; reproduces bugs before they are fixed. |
| [Security Engineer](../security-engineer/) | `specialist` | 0 */2 * * * | Reviews changes for vulnerabilities and hardens the codebase (read-first). |
| [Data Engineer](../data-engineer/) | `specialist` | */20 * * * * | Builds and maintains data pipelines, schemas and ETL jobs. |
| [ML Engineer](../ml-engineer/) | `specialist` | 0 */2 * * * | Prototypes, evaluates and ships ML/LLM features with honest metrics. |
| [Mobile Engineer](../mobile-engineer/) | `specialist` | */20 * * * * | Implements mobile/cross-platform app features and verifies builds. |
| [Code Reviewer](../code-reviewer/) | `specialist` | */15 * * * * | Reviews open PRs for correctness, style and risk — approves or requests changes. |
| [Release Manager](../release-manager/) | `specialist` | 0 */3 * * * | Owns the merge gate and release notes; coordinates safe rollouts (Owner approves prod). |

### Design & Content (3 personas)

| Persona | Role | Schedule | Summary |
|---|---|---|---|
| [Technical Writer](../technical-writer/) | `specialist` | 0 */4 * * * | Writes and updates docs from the code and shipped changes — keeps docs from drifting. |
| [UX Designer](../ux-designer/) | `specialist` | 0 */6 * * * | Specifies flows, interaction and copy so frontend engineers can build without guessing. |
| [Content Marketer](../content-marketer/) | `specialist` | 0 9 * * * | Produces blog, social and announcement copy from real shipped work. |

### Data & Research (2 personas)

| Persona | Role | Schedule | Summary |
|---|---|---|---|
| [Data Analyst](../data-analyst/) | `specialist` | 0 */6 * * * | Answers questions from data with honest, reproducible analysis. |
| [Research Analyst](../research-analyst/) | `specialist` | 0 */8 * * * | Runs multi-source research and delivers cited, fact-checked briefs. |

### Growth & Sales (2 personas)

| Persona | Role | Schedule | Summary |
|---|---|---|---|
| [Growth Marketer](../growth-marketer/) | `specialist` | 0 10 * * * | Designs and tracks growth experiments; reports what actually moved the metric. |
| [Sales Development Rep](../sales-development-rep/) | `specialist` | 0 */4 * * * | Researches leads and drafts tailored outreach for the Owner to send. |

### Operations & Support (3 personas)

| Persona | Role | Schedule | Summary |
|---|---|---|---|
| [Customer Support Agent](../customer-support-agent/) | `specialist` | */10 * * * * | Triages support requests, answers what it can, routes the rest with context. |
| [Community Manager](../community-manager/) | `specialist` | 0 */3 * * * | Monitors community channels, summarizes signal, drafts responses. |
| [Recruiter / People Ops](../recruiter/) | `specialist` | 0 11 * * * | Identifies capability gaps and proposes which persona to spawn next. |

### Finance & Legal (2 personas)

| Persona | Role | Schedule | Summary |
|---|---|---|---|
| [Finance Controller (Sanierer)](../finance-controller/) | `sanierer` | 0 */2 * * * | Watches budget and cost/output ratio; alerts the Owner directly on breaches. |
| [Legal & Compliance Officer](../legal-compliance-officer/) | `specialist` | 0 12 * * * | Reviews content and changes for legal/compliance risk; flags, never approves. |

## Infrastructure Recipes

These are not org personas but shipped in this catalog for direct deploy:

| Recipe | Purpose |
|---|---|
| [service-agent](../service-agent/) | Drains a service provider's A2A task queue (`/api/agent/tasks/next`) every minute. |
| [bluesky-summary](../bluesky-summary/) | Twice-daily Bluesky timeline digest. |

## Deploy a Persona

To deploy a persona directly:

```bash
apes agent deploy github.com/openape-ai/agent-catalog/<persona>@v0.2.0 \
  --param org_id=<your-org-id> \
  --param org_name="<Your Org>"
```

Or spawn any persona from the org chart in ORG by selecting it from the persona catalog.

## Source of Truth

This documentation is derived from:
- [`catalog.json`](../catalog.json) — the canonical persona definitions
- Individual persona READMEs (e.g., [`ceo/README.md`](../ceo/README.md))

To regenerate persona recipes:
1. Edit `_build/personas.mjs`
2. Run `node _build/generate.mjs`
3. Validate: `apps/openape-troop` → `pnpm tsx scripts/validate-catalog.ts`
