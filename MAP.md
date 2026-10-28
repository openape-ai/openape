# OpenApe system map

One page: which part does what, where it runs, and which names are retired.
Package details: [workspace map](docs/architecture/workspace-map.md). Checked 2026-10-28.

```text
① Identity & access ──────── every other part signs in and is authorized here
        │
        ├── ② Work apps        tasks · timetrack · git · monitor · dashboard · docs
        ├── ③ Evidence         Reports (testrun) · Plans · PR review results
        ├── ④ Pods             automation on the Mac, relay, phone inbox
        └── ⑤ CLI              apes + per-service ape-* CLIs
⑥ Operations: chatty (prod), forge, local stack, LLM gateway
```

## ① Identity & access

DDISA identity, grants, secrets and authorized egress.

| Workspace | Role |
| --- | --- |
| `apps/openape-free-idp` | Identity provider (id.openape.ai): users, agents, grants |
| `packages/{core,auth,grants}` | Protocol basics, DDISA/OIDC, grant lifecycle |
| `modules/nuxt-auth-{idp,sp}` | Nuxt integration for IdP and service providers |
| `packages/cli-auth` | Shared CLI token exchange and refresh |
| `apps/openape-secrets`, `packages/secrets-crypto` | Secrets vault |
| `packages/proxy` | HTTP gateway for authorized agent requests |
| `packages/protocol-conformance`, `examples/{idp,sp,e2e}` | Conformance tests and reference apps |

## ② Work apps

`apps/openape-{tasks,timetrack,git,monitor,dashboard}` and `apps/docs`.

## ③ Evidence

Everything that ends as a reviewable link.

| Workspace | Role |
| --- | --- |
| `apps/openape-testrun` | Reports (report.openape.ai, testrun.openape.ai) |
| `apps/openape-plans` | Plans (plans.openape.ai); shares `report-contracts` with Reports |
| `apps/openape-pr` | PR review results |
| `packages/report-contracts` | Shared HTML validation for Reports, Plans and the CLI |

## ④ Pods

`apps/openape-pods` (macOS app), `apps/openape-pods-relay` (pods.openape.ai),
`packages/{pods-protocol,agent-runtime,sp-tasks,attention-events,prompt-injection-detector}`.

## ⑤ CLI

`packages/apes` is the main CLI (identity, grants, agents, shapes via `packages/shapes`).
Per-service CLIs: `packages/ape-{tasks,timetrack,plans,pr,secrets,testruns,calls,kpi}`,
sharing `packages/proof-cli`.

## ⑥ Operations

| Where | What runs | Source |
| --- | --- | --- |
| chatty.delta-mind.at | idp, pods-idp, pods-relay, testrun, plans, pr, tasks, timetrack, monitor, secrets, dashboard | `compose/chatty.yml` |
| chatty.delta-mind.at | LLM gateway (llms-auth, llms-route, codex proxy, litellm) | `apps/openape-llm`, `packages/codex-proxy`, `compose/openape-llm.codex.yml` |
| chatty.delta-mind.at | Static sites (docs, website, delta-mind, …) | `compose/docs-site.yml`, sibling repos |
| repos.openape.ai | Native forge, issues, CI | `apps/openape-git`, `compose/forge.yml` |
| Local | Integration stack | `compose/local-stack.yml` |

## Retired names

Source lives in the [legacy repository](https://repos.openape.ai/patrick/legacy) or is gone. Do not revive.

| Name | Was | State 2026-10-28 |
| --- | --- | --- |
| troop, crm, chat, chat-cli, nest | Agent company, CRM, chat | Not deployed; old PR previews stopped |
| coder, ape-agent, question-service | Agent experiments | Not deployed |
| openclaw, apes-openclaw, openclaw-grant-gate | Operator loop | Retired |
| desktop | Tauri desktop | Abandoned; replaced by Pods |

## Open questions

- Ten Coolify PR-preview containers (troop, chat, free-idp; PRs 1224–1317) were stopped on 2026-10-28 but not removed; `chat-demo` still runs on chatty.
