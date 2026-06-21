# Tool Catalog

The Tool Catalog defines all tools available to agents in the OpenApe runtime.

## What is the Tool Catalog?

The Tool Catalog (`apps/openape-troop/server/tool-catalog.json`) is the authoritative list of tools the `apes-runtime` ships. It serves two purposes:

1. **Server-side validation**: The server validates `POST /api/agents/:name/tasks` payloads against this catalog — agents can only request tools that exist.
2. **UI reference**: The web UI fetches the catalog via `GET /api/tool-catalog` to populate the tool picker.

Each tool entry includes:
- `name`: The tool identifier used in agent requests
- `description`: Human-readable description of what the tool does
- `inputs`: JSON schema describing the tool's input parameters
- `risk`: Risk level (`low`, `medium`, `high`) that determines approval requirements

## Adding a New Tool

To add a new tool:

1. Implement the tool in `packages/apes/src/lib/agent-tools/`
2. Add an entry to `apps/openape-troop/server/tool-catalog.json`
3. Update this documentation

Do not edit the catalog without adding the corresponding tool implementation.

## Available Tools

### Low Risk (Auto-Approved)

| Tool | Description | Inputs |
|------|-------------|--------|
| `time.now` | Current UTC timestamp + ISO date. Useful as a sanity check that tool-calling round-trips. | `none` |
| `tasks.list` | List the owner's open ape-tasks (personal task list at tasks.openape.ai), optionally filtered by status. | `{ status?: 'open'\\|'doing'\\|'done'\\|'archived', team_id?: string }` |
| `mail.list` | List recent inbox messages via o365-cli. Only available if the agent host has o365-cli installed and authenticated. | `{ limit?: number, unread_only?: boolean }` |
| `mail.search` | Search inbox via o365-cli with a query string. | `{ q: string, limit?: number }` |
| `file.edit` | Replace an exact substring in a file under the agent's home directory. Touches only the changed region. Path traversal blocked, OS-confined to `$HOME`. | `{ path: string, old_string: string, new_string: string, replace_all?: boolean }` |
| `forge.pr.status` | Fetch a PR's state, checks, and review decision. Gated (read). | `{ forge?: 'github'\\|'azure', remote?: string, ref: string }` |
| `forge.issue.get` | Fetch an issue (GitHub) or work-item (Azure) — title, body, labels. Gated (read). | `{ forge?: 'github'\\|'azure', remote?: string, ref: string }` |
| `troop.company.read` | Read your troop company (objectives \\| reports \\| members \\| cost-snapshots \\| overview). Authenticated as the agent; read-only. | `{ resource: string, org_id: string }` |

### Medium Risk (Owner Approval or YOLO Scope)

| Tool | Description | Inputs |
|------|-------------|--------|
| `http.get` | GET an HTTPS URL and return the body (capped at 1MB). Headers are agent-controlled within a deny-list of dangerous values. | `{ url: string, headers?: Record<string,string> }` |
| `http.post` | POST JSON to an HTTPS URL and return the response body. Same caps + header policy as http.get. | `{ url: string, body: unknown, headers?: Record<string,string> }` |
| `file.read` | Read a file from the agent's home directory (`$HOME`). Path traversal blocked. Capped at 1MB. | `{ path: string }` |
| `tasks.create` | Create a new ape-task on the owner's task list. | `{ title: string, notes?: string, priority?: 'low'\\|'med'\\|'high', due_at?: string }` |
| `verify` | Run the verification command (tests/build/lint) in a worktree and report pass/fail. The coding loop must not open or merge a PR on failure. Gated like bash. | `{ cwd: string, command: string, timeout_ms?: number }` |
| `troop.objective.upsert` | Create or update a company objective on troop.openape.ai (authenticated as the agent). | `{ org_id: string, objective_id?: string, title?: string, description?: string, status?: string, target_date?: number }` |

### High Risk (Owner Approval Required)

| Tool | Description | Inputs |
|------|-------------|--------|
| `file.write` | Write a file in the agent's home directory (`$HOME`). Path traversal blocked. 1MB max payload. | `{ path: string, content: string }` |
| `bash` | Run a shell command on the agent host via ape-shell. Every command goes through the DDISA grant cycle — auto-approved by a matching YOLO scope or owner push notification. Runs as the agent's macOS user; file/network access is limited to what that user can see. | `{ cmd: string, timeout_ms?: number }` |
| `git.worktree` | Manage isolated git worktrees for coding tasks: create (clone-if-needed + worktree on a new branch under `~/work/<task_id>`), remove, list. Git operations go through the DDISA grant cycle (git-shape). | `{ action: 'create'\\|'remove'\\|'list', repo?: string, task_id?: string, branch?: string }` |
| `forge.pr.create` | Open a pull request on GitHub (gh) or Azure DevOps (az). Provider via `forge` or auto-detected from `remote`. Gated. | `{ forge?: 'github'\\|'azure', remote?: string, title: string, body: string, head: string, base?: string }` |
| `forge.pr.merge` | Merge a PR or arm merge-when-green (auto). Never bypasses required checks — branch protection is the server-side gate. Gated. | `{ forge?: 'github'\\|'azure', remote?: string, ref: string, auto?: boolean, squash?: boolean, delete_branch?: boolean }` |
| `agent.spawn` | Spawn a worker agent on the nest via troop, tiering its model + reasoning_effort by task difficulty. The orchestrator (PM) fans out workers in parallel. Requires the `troop:spawn-agent` scope. Gated. | `{ name: string, model?: string, reasoning_effort?: 'minimal'\\|'low'\\|'medium'\\|'high', recipe_ref?: string, system_prompt?: string }` |
| `agent.destroy` | Destroy a worker agent on the nest (full teardown). The PM tears down ephemeral workers after collecting their result. Requires the `troop:destroy-agent` scope. Gated. | `{ name: string }` |

## Risk Levels

- **Low**: Auto-approved, no owner intervention needed. These are read-only or non-destructive operations.
- **Medium**: Requires owner approval via push notification unless a matching YOLO scope exists. These may modify data but are contained.
- **High**: Always requires explicit owner approval. These can modify the codebase, spawn agents, or write files.

## Source Files

- **Catalog definition**: `apps/openape-troop/server/tool-catalog.json`
- **Tool implementations**: `packages/apes/src/lib/agent-tools/`
- **API endpoint**: `GET /api/tool-catalog` (serves the catalog to the UI)

## DDISA Grant Cycle

Tools with medium and high risk go through the DDISA grant cycle:
1. Agent requests the tool
2. System checks for a matching YOLO scope
3. If no YOLO scope, owner receives a push notification to approve
4. Command executes as the agent's macOS user with limited file/network access

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines on adding new tools.
