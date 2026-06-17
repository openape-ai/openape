# OpenApe Agent Catalog

A catalog of ready-to-deploy **agent personas**. Each persona is a pinned
recipe (`ape-agent.yaml`) that troop fetches, validates and deploys. Together
they let an Owner assemble a whole virtual company in
[ORG](https://org.openape.ai) — every member a real agent with its own DDISA
identity that **polls its own work** from
[tasks.openape.ai](https://tasks.openape.ai) and
[git.openape.ai](https://git.openape.ai) and processes it autonomously. You
never write per-task prompts: you assign work in the UI, the agents pick it up.

- **Repo ref form:** `github.com/openape-ai/agent-catalog/<persona>@v0.2.0`
- **Personas:** 29

## How autonomy works
Every persona shares one **operating protocol**. When its schedule fires it:
`apes whoami` → list its assigned `open,doing` tasks across its teams → pick the
single highest-priority one → mark it `doing` → do the work with its tools →
write the result back onto the task → `done`. Blocked work is reassigned to the
Owner with a note, never faked. Coding personas additionally pull issues from
Forgejo, branch → edit → verify → open a PR (never self-merge).

## Personas

### Leadership & Coordination

| Persona | Role | Polls code | Recipe |
|---|---|---|---|
| [Chief Executive (CEO)](ceo/) | `ceo` | — | `github.com/openape-ai/agent-catalog/ceo@v0.2.0` |
| [Chief Technology Officer (CTO)](cto/) | `teamlead` | yes | `github.com/openape-ai/agent-catalog/cto@v0.2.0` |
| [Product Manager](product-manager/) | `teamlead` | — | `github.com/openape-ai/agent-catalog/product-manager@v0.2.0` |
| [Engineering Manager](engineering-manager/) | `teamlead` | — | `github.com/openape-ai/agent-catalog/engineering-manager@v0.2.0` |
| [Project / Delivery Manager](project-manager/) | `teamlead` | — | `github.com/openape-ai/agent-catalog/project-manager@v0.2.0` |

### Engineering

| Persona | Role | Polls code | Recipe |
|---|---|---|---|
| [Backend Engineer](backend-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/backend-engineer@v0.2.0` |
| [Frontend Engineer](frontend-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/frontend-engineer@v0.2.0` |
| [Full-Stack Engineer](fullstack-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/fullstack-engineer@v0.2.0` |
| [DevOps Engineer](devops-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/devops-engineer@v0.2.0` |
| [Site Reliability Engineer (SRE)](site-reliability-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/site-reliability-engineer@v0.2.0` |
| [QA / Test Engineer](qa-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/qa-engineer@v0.2.0` |
| [Security Engineer](security-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/security-engineer@v0.2.0` |
| [Data Engineer](data-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/data-engineer@v0.2.0` |
| [ML Engineer](ml-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/ml-engineer@v0.2.0` |
| [Mobile Engineer](mobile-engineer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/mobile-engineer@v0.2.0` |
| [Code Reviewer](code-reviewer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/code-reviewer@v0.2.0` |
| [Release Manager](release-manager/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/release-manager@v0.2.0` |

### Design & Content

| Persona | Role | Polls code | Recipe |
|---|---|---|---|
| [Technical Writer](technical-writer/) | `specialist` | yes | `github.com/openape-ai/agent-catalog/technical-writer@v0.2.0` |
| [UX Designer](ux-designer/) | `specialist` | — | `github.com/openape-ai/agent-catalog/ux-designer@v0.2.0` |
| [Content Marketer](content-marketer/) | `specialist` | — | `github.com/openape-ai/agent-catalog/content-marketer@v0.2.0` |

### Data & Research

| Persona | Role | Polls code | Recipe |
|---|---|---|---|
| [Data Analyst](data-analyst/) | `specialist` | — | `github.com/openape-ai/agent-catalog/data-analyst@v0.2.0` |
| [Research Analyst](research-analyst/) | `specialist` | — | `github.com/openape-ai/agent-catalog/research-analyst@v0.2.0` |

### Growth & Sales

| Persona | Role | Polls code | Recipe |
|---|---|---|---|
| [Growth Marketer](growth-marketer/) | `specialist` | — | `github.com/openape-ai/agent-catalog/growth-marketer@v0.2.0` |
| [Sales Development Rep](sales-development-rep/) | `specialist` | — | `github.com/openape-ai/agent-catalog/sales-development-rep@v0.2.0` |

### Operations & Support

| Persona | Role | Polls code | Recipe |
|---|---|---|---|
| [Customer Support Agent](customer-support-agent/) | `specialist` | — | `github.com/openape-ai/agent-catalog/customer-support-agent@v0.2.0` |
| [Community Manager](community-manager/) | `specialist` | — | `github.com/openape-ai/agent-catalog/community-manager@v0.2.0` |
| [Recruiter / People Ops](recruiter/) | `specialist` | — | `github.com/openape-ai/agent-catalog/recruiter@v0.2.0` |

### Finance & Legal

| Persona | Role | Polls code | Recipe |
|---|---|---|---|
| [Finance Controller (Sanierer)](finance-controller/) | `sanierer` | — | `github.com/openape-ai/agent-catalog/finance-controller@v0.2.0` |
| [Legal & Compliance Officer](legal-compliance-officer/) | `specialist` | — | `github.com/openape-ai/agent-catalog/legal-compliance-officer@v0.2.0` |

### Infrastructure recipes
Not org personas, but shipped in this catalog for direct deploy:

| Recipe | Purpose |
|---|---|
| [service-agent](service-agent/) | Drains a service provider's A2A task queue (`/api/agent/tasks/next`) every minute. |
| [bluesky-summary](bluesky-summary/) | Twice-daily Bluesky timeline digest. |

## Understanding catalog.json

The `catalog.json` file is the source of truth for all persona definitions:

```json
{
  "version": "v0.2.0",
  "repo": "github.com/openape-ai/agent-catalog",
  "categories": [...],
  "personas": [...]
}
```

**Key fields:**
- `version` — Catalog version (ORG pins to this)
- `categories` — 7 functional groups (leadership, engineering, etc.)
- `personas` — 29 persona definitions with `key`, `title`, `role`, `category`, `icon`, `summary`, `coding`, `cadence`, `recipeRef`

See [`docs/PERSONAS.md`](docs/PERSONAS.md) for complete documentation.

## ORG Composition

An ORG is composed by spawning agents from this catalog. Each member has:
- A **persona** (from catalog)
- A **role** (`ceo`, `teamlead`, `specialist`, `sanierer`)
- An **email** (DDISA identity)
- A **reportsTo** relationship (optional)

**Example: OpenApe Werkstatt** (6 members)
| Agent | Persona | Role | Reports To |
|-------|---------|------|------------|
| ceo | CEO | ceo | — |
| pm | Product Manager | teamlead | — |
| cfo | Finance Controller | sanierer | — |
| backend | Backend Engineer | specialist | pm |
| qa | QA Engineer | specialist | pm |
| scribe | Technical Writer | specialist | pm |

## Go live
1. Push this directory to `github.com/openape-ai/agent-catalog`.
2. Tag the release: `git tag v0.2.0 && git push --tags`.
3. ORG's persona catalog already pins `@v0.2.0`, so spawning any
   persona from the org chart works immediately.

## Regenerate
Edit `_build/personas.mjs`, then `node _build/generate.mjs`.
Validate against the real troop parser: `apps/openape-troop` →
`pnpm tsx scripts/validate-catalog.ts`.
