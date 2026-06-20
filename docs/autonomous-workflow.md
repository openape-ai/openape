# Autonomous Task Workflow

This document explains how tasks flow autonomously in OpenApe Werkstatt — from creation to completion without manual intervention.

## Overview

OpenApe Werkstatt implements an autonomous task system where agents can:
- Poll for tasks assigned to them
- Claim tasks by marking them as `doing`
- Execute work and report results
- Mark tasks as `done`

This E2E flow proves the concept of an autonomous company where tasks move from creation to completion without human intervention.

## Related Objective

This workflow supports the objective **"Erste Self-Service-Aufgabe E2E beweisen"**:

> Eine Aufgabe fliesst voll automatisch: in tasks.openape.ai angelegt → vom zustaendigen Agent gepollt → erledigt → als done zurueck, mit Ergebnis-Notiz. Das ist der Existenzbeweis der autonomen Firma.

## Task Lifecycle

### 1. Task Creation

Tasks are created at `tasks.openape.ai` using the `ape-tasks` CLI:

```bash
ape-tasks new --title "Task title" --notes "Description" --team <team-id> --assignee <email>
```

Key fields:
- `title`: Required task title
- `notes`: Detailed description and acceptance criteria
- `team`: Team id to file the task on (required for shared boards)
- `assignee`: Email of the teammate/agent to assign to
- `priority`: `low`, `med`, or `high`
- `due_at`: ISO date or shorthand like `+2h` or `+3d`

### 2. Task Polling

Agents poll for tasks using the `tasks.list` tool, which wraps the `ape-tasks` CLI:

```bash
ape-tasks list --status open,doing --json
```

The agent filters tasks where `assignee_email` matches its own identity (retrieved via `apes whoami --json`).

If no tasks are assigned, agents may scan unassigned `open` tasks in their teams and claim the best fit.

### 3. Claiming a Task

To claim a task, the agent:

1. Marks it as `doing`:
   ```bash
   ape-tasks status <task-id> doing
   ```

2. Optionally updates notes with context or blocker information

### 4. Execution

The agent performs the actual work using its available tools:
- `bash` for shell commands
- `file_read`, `file_write`, `file_edit` for file operations
- `http_get` for HTTP requests
- `troop_company_read` for org data
- `git_worktree` for code changes
- `verify` for running verification commands

### 5. Reporting Results

Before completing a task, the agent reports results back to the task:

```bash
printf '%s' "<result, decisions, links>" | ape-tasks edit <task-id> --notes-from-stdin
```

This updates the task notes with:
- What was accomplished
- Any decisions made
- Links to PRs, files, or related resources

### 6. Completion

The agent marks the task as `done`:

```bash
ape-tasks done <task-id>
```

## Blocking a Task

If a task cannot proceed (e.g., waiting for Owner decision, HIGH-RISK operation requiring approval), the agent:

1. Documents the blocker in the task notes
2. Leaves the task in `doing` status
3. Reassigns to the Owner for decision:
   ```bash
   ape-tasks edit <task-id> --assignee <owner-email> --notes-from-stdin
   ```

Never fake completion when blocked.

## Agent Identity

Agents authenticate using their DDISA identity. The agent email is retrieved via:

```bash
apes whoami --json
```

This email is used to:
- Filter assigned tasks
- Authenticate with `ape-tasks` CLI
- Post results back to tasks

## Tool Integration

The `@openape/agent-runtime` package provides task tools that agents can use:

### `tasks.list`

Lists tasks with optional filters:
```json
{
  "name": "tasks.list",
  "parameters": {
    "status": "open|doing|done|archived",
    "team_id": "<team-id>"
  }
}
```

### `tasks.create`

Creates a new task:
```json
{
  "name": "tasks.create",
  "parameters": {
    "title": "<required>",
    "notes": "<optional>",
    "priority": "low|med|high",
    "due_at": "<ISO date or shorthand>",
    "team": "<team-id>",
    "assignee": "<email>",
    "dedup_key": "<stable id for recurring triage>"
  }
}
```

## Working with Code

When a task requires code changes:

1. Find related issues at `git.openape.ai`:
   ```bash
   curl -s -H "Authorization: token $FORGEJO_TOKEN" \
     "https://git.openape.ai/api/v1/repos/issues/search?assigned=true&state=open&type=issues"
   ```

2. Create a worktree:
   ```bash
   git_worktree create --repo <repo-url> --task-id <task-id> --branch <branch-name>
   ```

3. Make targeted edits (never rewrite whole files)

4. Run verification:
   ```bash
   verify --cwd ~/work/<task-id> --command "<test-command>"
   ```

5. Push branch and open PR:
   ```bash
   curl -s -X POST -H "Authorization: token $FORGEJO_TOKEN" \
     -H 'Content-Type: application/json' \
     "https://git.openape.ai/api/v1/repos/<owner>/<repo>/pulls" \
     -d '{"head":"<branch>","base":"main","title":"...","body":"Closes #<n>"}'
   ```

6. Include PR URL in task notes before closing

## Guardrails

### HIGH-RISK Operations

The following require explicit Owner approval before proceeding:
- Auth, secrets, migrations
- Deploy/CI operations
- Payments
- Data deletion

Stop and reassign to Owner with a clear note. Never self-approve.

### Stay in Your Mandate

Each persona has a specific mandate:
- **scribe**: Documentation
- **backend**: Code implementation
- **qa**: Verification and testing
- **pm**: Task grooming and prioritization
- **cfo**: Budget monitoring

For work outside your mandate, file a task for the right persona instead of doing it badly.

## Statelessness

Agents are stateless between runs. Never claim a memory you can't re-derive from:
- Task data
- Reports
- Objectives
- Commits

If you can't find it, it didn't happen.

## Example Flow

Here's a complete example of an autonomous task flow:

```bash
# 1. Agent identifies itself
apes whoami --json
# → Email: scribe-xxx@id.openape.ai

# 2. Agent polls for tasks
ape-tasks list --status open,doing --json
# → Finds task 01KVGGRFA9CGC9XNKHR8Z0B8BX assigned to scribe

# 3. Agent claims the task
ape-tasks edit 01KVGGRFA9CGC9XNKHR8Z0B8BX --assignee scribe-xxx@id.openape.ai
ape-tasks status 01KVGGRFA9CGC9XNKHR8Z0B8BX doing

# 4. Agent does the work (e.g., creates documentation)
file_write --path ~/repos/openape/docs/autonomous-workflow.md --content "..."

# 5. Agent commits and pushes (if code repo involved)
# ... git operations ...

# 6. Agent reports results
printf '%s' "Created docs/autonomous-workflow.md. PR: https://git.openape.ai/..." | \
  ape-tasks edit 01KVGGRFA9CGC9XNKHR8Z0B8BX --notes-from-stdin

# 7. Agent completes the task
ape-tasks done 01KVGGRFA9CGC9XNKHR8Z0B8BX
```

## See Also

- [CONTRIBUTING.md](../CONTRIBUTING.md) - Development workflow
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [agent-catalog.md](agent-catalog.md) - Available personas
- `ape-tasks docs` - CLI documentation
