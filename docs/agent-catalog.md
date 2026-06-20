# Agent Catalog

The Agent Catalog is the single source of truth for all personas available to compose a company via the ORG chart. Each persona maps to a pinned recipe in [github.com/openape-ai/agent-catalog](https://github.com/openape-ai/agent-catalog) and carries the structural ORG `role` it occupies on the chart.

**Source of truth**: [`apps/openape-troop/server/utils/persona-catalog.ts`](https://git.openape.ai/openape-ai/openape/blob/main/apps/openape-troop/server/utils/persona-catalog.ts)

---

## How to Compose a Company via ORG

1. Open the Org Chart in troop.openape.ai
2. Click to spawn a new member
3. Select a persona from the picker (grouped by category)
4. The persona's recipe is deployed with substituted parameters:
   - `{{org_id}}` → Your organization ID
   - `{{org_name}}` → Your organization name
   - `{{forge_base}}` → `https://git.openape.ai` (for coding personas)

---

## Persona Categories

| Category | Key |
|----------|-----|
| Leadership & Coordination | `leadership` |
| Engineering | `engineering` |
| Design & Content | `design-content` |
| Data & Research | `data-research` |
| Growth & Sales | `growth-sales` |
| Operations & Support | `operations` |
| Finance & Legal | `finance-legal` |

---

## Personas

### Leadership & Coordination

| Persona | Role | Coding | Summary |
|---------|------|--------|---------|
| **Chief Executive (CEO)** | `ceo` | No | Turns the Owner's vision into objectives and keeps the company pointed at them. |
| **Chief Technology Officer (CTO)** | `teamlead` | Yes | Owns technical strategy, architecture direction and engineering standards. |
| **Product Manager** | `teamlead` | No | Maintains the backlog — converts goals into well-specified, prioritized tasks. |
| **Engineering Manager** | `teamlead` | No | Decomposes engineering objectives into stories and routes them to engineers. |
| **Project / Delivery Manager** | `teamlead` | No | Keeps timelines, dependencies and risks visible; chases blockers across teams. |

### Engineering

| Persona | Role | Coding | Summary |
|---------|------|--------|---------|
| **Backend Engineer** | `specialist` | Yes | Implements server-side features, APIs and data access against assigned issues. |
| **Frontend Engineer** | `specialist` | Yes | Builds UI components and flows; verifies them render and behave correctly. |
| **Full-Stack Engineer** | `specialist` | Yes | Ships end-to-end features spanning UI, API and data. |
| **DevOps Engineer** | `specialist` | Yes | Owns CI/CD, containers and deploy pipelines (proposes, never self-deploys prod). |
| **Site Reliability Engineer (SRE)** | `specialist` | Yes | Watches health/SLOs, triages incidents, files and fixes reliability issues. |
| **QA / Test Engineer** | `specialist` | Yes | Writes and strengthens tests; reproduces bugs before they are fixed. |
| **Security Engineer** | `specialist` | Yes | Reviews changes for vulnerabilities and hardens the codebase (read-first). |
| **Data Engineer** | `specialist` | Yes | Builds and maintains data pipelines, schemas and ETL jobs. |
| **ML Engineer** | `specialist` | Yes | Prototypes, evaluates and ships ML/LLM features with honest metrics. |
| **Mobile Engineer** | `specialist` | Yes | Implements mobile/cross-platform app features and verifies builds. |
| **Code Reviewer** | `specialist` | Yes | Reviews open PRs for correctness, style and risk — approves or requests changes. |
| **Release Manager** | `specialist` | Yes | Owns the merge gate and release notes; coordinates safe rollouts (Owner approves prod). |

### Design & Content

| Persona | Role | Coding | Summary |
|---------|------|--------|---------|
| **Technical Writer** | `specialist` | Yes | Writes and updates docs from the code and shipped changes — keeps docs from drifting. |
| **UX Designer** | `specialist` | No | Specifies flows, interaction and copy so frontend engineers can build without guessing. |
| **Content Marketer** | `specialist` | No | Produces blog, social and announcement copy from real shipped work. |

### Data & Research

| Persona | Role | Coding | Summary |
|---------|------|--------|---------|
| **Data Analyst** | `specialist` | No | Answers questions from data with honest, reproducible analysis. |
| **Research Analyst** | `specialist` | No | Runs multi-source research and delivers cited, fact-checked briefs. |

### Growth & Sales

| Persona | Role | Coding | Summary |
|---------|------|--------|---------|
| **Growth Marketer** | `specialist` | No | Designs and tracks growth experiments; reports what actually moved the metric. |
| **Sales Development Rep** | `specialist` | No | Researches leads and drafts tailored outreach for the Owner to send. |

### Operations & Support

| Persona | Role | Coding | Summary |
|---------|------|--------|---------|
| **Customer Support Agent** | `specialist` | No | Triage support requests, answers what it can, routes the rest with context. |
| **Community Manager** | `specialist` | No | Monitors community channels, summarizes signal, drafts responses. |
| **Recruiter / People Ops** | `specialist` | No | Identifies capability gaps and proposes which persona to spawn next. |

### Finance & Legal

| Persona | Role | Coding | Summary |
|---------|------|--------|---------|
| **Finance Controller (Sanierer)** | `sanierer` | No | Watches budget and cost/output ratio; alerts the Owner directly on breaches. |
| **Legal & Compliance Officer** | `specialist` | No | Reviews content and changes for legal/compliance risk; flags, never approves. |

---

## Summary

- **Total Personas**: 29
- **Coding Personas**: 14 (work on Forgejo)
- **Non-Coding Personas**: 15
- **Role Distribution**:
  - `ceo`: 1
  - `teamlead`: 4
  - `specialist`: 23
  - `sanierer`: 1

---

## Recipe References

All personas reference pinned recipes from `github.com/openape-ai/agent-catalog`. The recipe params are substituted at spawn time with your organization's context.

| Persona | Recipe Reference |
|---------|------------------|
| CEO | `github.com/openape-ai/agent-catalog/ceo@v0.2.0` |
| CTO | `github.com/openape-ai/agent-catalog/cto@v0.2.0` |
| Product Manager | `github.com/openape-ai/agent-catalog/product-manager@v0.2.0` |
| Engineering Manager | `github.com/openape-ai/agent-catalog/engineering-manager@v0.2.0` |
| Project / Delivery Manager | `github.com/openape-ai/agent-catalog/project-manager@v0.2.0` |
| Backend Engineer | `github.com/openape-ai/agent-catalog/backend-engineer@v0.2.0` |
| Frontend Engineer | `github.com/openape-ai/agent-catalog/frontend-engineer@v0.2.0` |
| Full-Stack Engineer | `github.com/openape-ai/agent-catalog/fullstack-engineer@v0.2.0` |
| DevOps Engineer | `github.com/openape-ai/agent-catalog/devops-engineer@v0.2.0` |
| Site Reliability Engineer (SRE) | `github.com/openape-ai/agent-catalog/site-reliability-engineer@v0.2.0` |
| QA / Test Engineer | `github.com/openape-ai/agent-catalog/qa-engineer@v0.2.0` |
| Security Engineer | `github.com/openape-ai/agent-catalog/security-engineer@v0.2.0` |
| Data Engineer | `github.com/openape-ai/agent-catalog/data-engineer@v0.2.0` |
| ML Engineer | `github.com/openape-ai/agent-catalog/ml-engineer@v0.2.0` |
| Mobile Engineer | `github.com/openape-ai/agent-catalog/mobile-engineer@v0.2.0` |
| Code Reviewer | `github.com/openape-ai/agent-catalog/code-reviewer@v0.2.0` |
| Release Manager | `github.com/openape-ai/agent-catalog/release-manager@v0.2.0` |
| Technical Writer | `github.com/openape-ai/agent-catalog/technical-writer@v0.2.0` |
| UX Designer | `github.com/openape-ai/agent-catalog/ux-designer@v0.2.0` |
| Content Marketer | `github.com/openape-ai/agent-catalog/content-marketer@v0.2.0` |
| Data Analyst | `github.com/openape-ai/agent-catalog/data-analyst@v0.2.0` |
| Research Analyst | `github.com/openape-ai/agent-catalog/research-analyst@v0.2.0` |
| Growth Marketer | `github.com/openape-ai/agent-catalog/growth-marketer@v0.2.0` |
| Sales Development Rep | `github.com/openape-ai/agent-catalog/sales-development-rep@v0.2.0` |
| Customer Support Agent | `github.com/openape-ai/agent-catalog/customer-support-agent@v0.2.0` |
| Community Manager | `github.com/openape-ai/agent-catalog/community-manager@v0.2.0` |
| Recruiter / People Ops | `github.com/openape-ai/agent-catalog/recruiter@v0.2.0` |
| Finance Controller (Sanierer) | `github.com/openape-ai/agent-catalog/finance-controller@v0.2.0` |
| Legal & Compliance Officer | `github.com/openape-ai/agent-catalog/legal-compliance-officer@v0.2.0` |

---

*This documentation reflects the current state of the persona catalog. Updates are made when new personas are added or existing ones are modified.*
